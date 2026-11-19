import type { BoardProgress } from './optimizer';
import type { OptimizationProgress } from './optimizationProtocol';

export function trackOptimizationTime(boardWork: number[], workers: number, startedAt: number, memoryRetry: boolean,
  report: (progress: OptimizationProgress) => void, now = () => performance.now()) {
  const boards = boardWork.map(total => ({ total, completed: 0, started: -1, sampled: 0, finished: false }));
  let lastReportAt = now();
  let lastEstimate: number | null = null;
  report({ memoryRetry, durationSeconds: null });

  function updateEstimate(time: number) {
    if (time - lastReportAt < 350 || boards.every(board => board.finished)) return;
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
    const durationSeconds = Math.max(1, Math.round(elapsed + remaining));
    lastReportAt = time;
    if (durationSeconds === lastEstimate) return;
    lastEstimate = durationSeconds;
    report({ memoryRetry, durationSeconds });
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
