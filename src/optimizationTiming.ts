import type { BoardProgress } from './optimizer';
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
