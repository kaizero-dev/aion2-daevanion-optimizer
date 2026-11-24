import type { BoardProgress, BoardSolveInput, MergeProgress } from './optimizer';
import type { OptimizationProgress } from './optimizationProtocol';

export function trackOptimizationTime(boardWork: number[], workers: number, startedAt: number, memoryRetry: boolean,
  report: (progress: OptimizationProgress) => void, now = () => performance.now()) {
  const boards = boardWork.map(total => ({ total, completed: 0, started: -1, sampled: 0, finished: false }));
  const recentEstimates: number[] = [];
  let lastSampleAt = now();
  let lastReportAt = lastSampleAt;
  let lastEstimate: number | null = null;
  report({ phase: 'calculating', memoryRetry, durationSeconds: null });

  function updateEstimate(time: number) {
    if (time - lastSampleAt < 350 || boards.every(board => board.finished)) return;
    let measuredWork = 0;
    let measuredTime = 0;
    for (const board of boards) {
      if (board.completed < board.total * 0.08) continue;
      measuredWork += board.completed;
      measuredTime += board.sampled;
    }
    if (!measuredWork || !measuredTime) return;
    const millisecondsPerUnit = measuredTime / measuredWork;

    // Place queued boards on the next free worker, in dispatch order.
    const slots = boards.filter(board => board.started >= 0 && !board.finished)
      .map(board => (board.total - board.completed) * millisecondsPerUnit);
    while (slots.length < workers) slots.push(0);
    for (const board of boards) {
      if (board.started >= 0 || board.finished) continue;
      const nextWorker = slots.indexOf(Math.min(...slots));
      slots[nextWorker] += board.total * millisecondsPerUnit;
    }

    const elapsed = (time - startedAt) / 1000;
    const remaining = Math.max(...slots) / 1000;
    if (!Number.isFinite(remaining)) return;
    lastSampleAt = time;
    recentEstimates.push(elapsed + remaining);
    if (recentEstimates.length > 3) recentEstimates.shift();
    if (recentEstimates.length < 3 || time - lastReportAt < 1000) return;

    const average = recentEstimates.reduce((sum, estimate) => sum + estimate, 0) / recentEstimates.length;
    const durationSeconds = Math.max(1, Math.ceil(elapsed), Math.round(average));
    lastReportAt = time;
    if (durationSeconds === lastEstimate) return;
    lastEstimate = durationSeconds;
    report({ phase: 'calculating', memoryRetry, durationSeconds });
  }

  return {
    start(index: number) {
      const board = boards[index];
      board.started = now();
      board.finished = false;
    },
    reuse(index: number) {
      boards[index].finished = true;
    },
    sample(index: number, { completedWork, totalWork }: BoardProgress) {
      const board = boards[index];
      const time = now();
      board.total = totalWork;
      board.completed = completedWork;
      board.sampled = time - board.started;
      if (completedWork > 0) updateEstimate(time);
    },
    finish(index: number) {
      const board = boards[index];
      const time = now();
      board.finished = true;
      board.completed = board.total;
      board.sampled = time - board.started;
      updateEstimate(time);
    },
  };
}

// Before the tables exist, count possible skill-count pairs and approximate the
// width of a cost frontier from the number of nodes that can improve its score.
function projectMergeWork(boards: BoardSolveInput[]) {
  const targets = boards[0]?.skillTargets ?? [];
  const counts = boards.map(({ nodes }) => {
    const available = targets.map(() => 0);
    for (const { skill, selectable } of nodes) {
      if (skill !== undefined && selectable) available[skill]++;
    }
    return available;
  });
  const remaining = targets.map((_, i) => counts.reduce((sum, board) => sum + board[i], 0));
  const seen = targets.map(() => 0);
  let prefixWidth = 1;
  return boards.map(({ nodes, limit }, index) => {
    const width = Math.max(1, Math.min(limit + 1,
      Math.ceil(nodes.filter(node => node.selectable && node.targetValue > 0).length * 0.55)));
    let pairs = 1;
    for (const [skill, target] of targets.entries()) {
      const local = counts[index][skill];
      remaining[skill] -= local;
      let allowed = 0;
      for (let a = 0; a <= Math.min(target, seen[skill]); a++) {
        const first = Math.max(0, target - remaining[skill] - a);
        allowed += Math.max(0, Math.min(target, local) - first + 1);
      }
      seen[skill] += local;
      pairs *= allowed;
    }
    const work = pairs * prefixWidth * (index === boards.length - 1 ? 1 : width);
    prefixWidth += width;
    return work;
  });
}

export function trackMergeTime(boards: BoardSolveInput[], now = () => performance.now()) {
  const projected = projectMergeWork(boards);
  const laterWork = projected.map((_, i) => projected.slice(i + 1).reduce((sum, work) => sum + work, 0));
  // Calibrated in cost-pair units per millisecond. Measured progress supersedes
  // this rate once the current merge stage has a meaningful timing sample.
  const initialRate = 180_000;
  let index = -1;
  let startedAt = 0;
  let remainingWork = projected.reduce((sum, work) => sum + work, 0);
  let rate = initialRate;
  let lastMeasuredRate = initialRate;

  return {
    sample(progress: MergeProgress) {
      const time = now();
      if (progress.index !== index) {
        index = progress.index;
        startedAt = time;
        rate = lastMeasuredRate;
      }
      const elapsed = time - startedAt;
      if (elapsed >= 200 && progress.completedWork > 0) {
        rate = progress.completedWork / elapsed;
        lastMeasuredRate = rate;
      }
      remainingWork = Math.max(0, progress.totalWork - progress.completedWork) + laterWork[index];
    },
    remainingSeconds() {
      return (350 + remainingWork / rate * 1.25) / 1000;
    },
  };
}
