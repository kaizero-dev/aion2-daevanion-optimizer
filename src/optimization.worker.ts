import manifest from '../data/manifest.json';
import { createGradeAdapter } from './grades';
import { buildGraph, prepareInput, type OptimizationGraph, type PreparedInput } from './optimizationGraph';
import { createOptimizationPlan, OptimizationMemoryLimit, type BoardOptimizationTable, type BoardSolveInput } from './optimizer';
import { trackMergeTime, trackOptimizationTime } from './optimizationTiming';
import type { BoardWorkerRequest, BoardWorkerResponse, OptimizationProgress, OptimizationRequest, OptimizationWorkerMessage } from './optimizationProtocol';

const { costs } = createGradeAdapter(manifest.grades);
const classKeys = manifest.classes.map(character => character.key);
const memoryTiers = [[32, 6144], [16, 3072], [8, 1536]] as const;

async function solveBoards(boards: BoardSolveInput[], workerCount: number, memoryLimit: number,
  timing: ReturnType<typeof trackOptimizationTime>, tables: (BoardOptimizationTable | undefined)[]) {
  const workers: Worker[] = [];
  const boardCount = boards.length;
  const sharedBudget = globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function'
    ? { used: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), limit: memoryLimit }
    : undefined;
  // Keep the traversal probe at the previous per-worker threshold.
  const traversalBudget = Math.floor(memoryLimit * 3 / 4 / workerCount);
  const tableLimit = sharedBudget ? undefined : Math.floor(memoryLimit / 4 / boardCount);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let nextIndex = 0;
      let remaining = boardCount;
      const dispatch = (worker: Worker) => {
        if (nextIndex >= boardCount) return;
        const index = nextIndex++;
        timing.start(index);
        worker.postMessage({ index, board: boards[index] } satisfies BoardWorkerRequest);
      };
      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(new URL('./optimizationBoard.worker.ts', import.meta.url), { type: 'module' });
        workers.push(worker);
        worker.onmessage = ({ data }: MessageEvent<BoardWorkerResponse>) => {
          if ('failure' in data) { reject(new OptimizationMemoryLimit()); return; }
          if ('progress' in data) { timing.sample(data.index, data.progress); return; }
          // Even with the entire budget, this board cannot meet its fixed requirements.
          if (data.table === null) { resolve(false); return; }
          tables[data.index] = data.table;
          timing.finish(data.index);
          if (--remaining === 0) resolve(true);
          else {
            try { dispatch(worker); }
            catch (error) { reject(error); }
          }
        };
        worker.onerror = reject;
        worker.onmessageerror = reject;
        worker.postMessage({ memoryLimit: traversalBudget, tableLimit, sharedBudget } satisfies BoardWorkerRequest);
        dispatch(worker);
      }
    });
  } finally {
    workers.forEach(worker => worker.terminate());
  }
}

async function optimize(graph: OptimizationGraph, { availablePoints, commonNodePriority }: OptimizationRequest['settings'],
  { required, skills }: Extract<PreparedInput, { ok: true }>, deviceMemoryGiB: number, startedAt: number,
  report: (progress: OptimizationProgress) => void) {
  // The device signal describes approximate total RAM, so leave headroom for
  // the browser, the OS, and allocations outside the solver's estimate.
  const budgetMiB = memoryTiers.find(([minimumGiB]) => deviceMemoryGiB >= minimumGiB)?.[1]
    ?? Math.max(128, deviceMemoryGiB * 128);
  const memoryLimit = budgetMiB * 1024 ** 2;
  const plan = createOptimizationPlan(graph, availablePoints, required, commonNodePriority, skills, { memoryLimit });
  if (!plan || !('solveBoard' in plan)) return plan;

  const boardWork = plan.boards.map(board => board.totalWork);
  const boardCount = boardWork.length;
  const workerCount = Math.min(deviceMemoryGiB > 4 ? 3 : 1, boardCount, navigator.hardwareConcurrency || 1);
  const tables: (BoardOptimizationTable | undefined)[] = [];
  const mergeTiming = trackMergeTime(plan.boards);
  let firstEstimate: number | null = null;
  let calculationEstimate: number | null = null;
  const reportCalculation = (progress: OptimizationProgress) => {
    const estimate = progress.durationSeconds === null
      ? null : Math.ceil(progress.durationSeconds + mergeTiming.remainingSeconds());
    if (estimate === null) firstEstimate = null;
    else firstEstimate ??= estimate;
    // Early frontier throughput can swing sharply as boards start and finish.
    // Keep the first estimate as a floor until actual merge work is available.
    const durationSeconds = estimate === null ? null : Math.max(firstEstimate ?? estimate, estimate);
    if (durationSeconds !== null && durationSeconds === calculationEstimate) return;
    calculationEstimate = durationSeconds;
    report({ ...progress, durationSeconds });
  };
  let memoryRetry = workerCount > 1;
  if (workerCount > 1) {
    try {
      const timing = trackOptimizationTime(boardWork, workerCount, startedAt, false, reportCalculation);
      const feasible = await solveBoards(plan.boards, workerCount, memoryLimit, timing, tables);
      if (!feasible) return null;
    } catch (error) {
      memoryRetry = error instanceof OptimizationMemoryLimit;
    }
  }

  let timing: ReturnType<typeof trackOptimizationTime> | undefined;
  let finalizing = false;
  let finalEstimate: number | null = null;
  const reportFinalizing = () => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const durationSeconds = Math.ceil(elapsed + mergeTiming.remainingSeconds());
    if (durationSeconds === finalEstimate) return;
    finalEstimate = durationSeconds;
    report({ phase: 'finalizing', memoryRetry: timing !== undefined && memoryRetry, durationSeconds });
  };
  return plan.finish(index => {
    if (!timing) {
      timing = trackOptimizationTime(boardWork, 1, startedAt, memoryRetry, reportCalculation);
      for (let i = 0; i < boardCount; i++) {
        if (i < index || tables[i] !== undefined) timing.reuse(i);
      }
    } else if (finalizing) {
      reportCalculation({ phase: 'calculating', memoryRetry, durationSeconds: null });
    }
    finalizing = false;
    finalEstimate = null;
    const sequential = timing;
    sequential.start(index);
    const table = plan.solveBoard(index, progress => sequential.sample(index, progress));
    sequential.finish(index);
    return table;
  }, tables, () => {
    if (finalizing) return;
    finalizing = true;
    reportFinalizing();
  }, progress => {
    mergeTiming.sample(progress);
    if (finalizing) reportFinalizing();
  });
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<OptimizationRequest>) => void) | null; postMessage: (message: OptimizationWorkerMessage) => void };
scope.onmessage = async ({ data: { requestId, settings, boards, deviceMemoryGiB = 0 } }) => {
  const startedAt = performance.now();
  try {
    const classInfo = manifest.classes.find(c => c.key === settings.classKey);
    if (!classInfo || boards.length !== classInfo.boards.length || classInfo.boards.some(b => !boards.some(board => board.boardKey === b.key))) throw new Error('Invalid class boards');
    const graph = buildGraph(boards, costs);
    const prepared = prepareInput(graph, settings, classKeys);
    if (!prepared.ok) { scope.postMessage({ requestId, failure: prepared.kind }); return; }
    const result = await optimize(graph, settings, prepared, deviceMemoryGiB, startedAt,
      progress => scope.postMessage({ requestId, progress }));
    scope.postMessage(result ? { requestId, result } : { requestId, failure: 'insufficient-points' });
  } catch (error) {
    scope.postMessage({ requestId, failure: error instanceof OptimizationMemoryLimit ? 'resource-limit' : 'optimization-failed' });
  }
};
