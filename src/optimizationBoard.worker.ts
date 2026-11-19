import { boardTableBytes, createBoardSolver, OptimizationMemoryLimit } from './optimizer';
import type { BoardWorkerRequest, BoardWorkerResponse } from './optimizationProtocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BoardWorkerRequest>) => void) | null;
  postMessage: (response: BoardWorkerResponse, transfer?: Transferable[]) => void;
};
let solver: ReturnType<typeof createBoardSolver> | undefined;
let tableLimit: number | undefined;

scope.onmessage = ({ data }) => {
  if ('memoryLimit' in data) {
    tableLimit = data.tableLimit;
    solver = createBoardSolver(data.memoryLimit, undefined, data.sharedBudget);
    return;
  }
  if (!solver) throw new Error('Board worker has not been initialized');
  try {
    const table = solver.solveBoard(data.board, progress => scope.postMessage({ index: data.index, progress }));
    const tableBytes = boardTableBytes(table);
    if (tableLimit !== undefined && tableBytes > tableLimit) throw new OptimizationMemoryLimit();
    const transfer: Transferable[] = [];
    for (const entries of table?.values() ?? []) {
      transfer.push(entries.scores.buffer, entries.specials.buffer);
    }
    solver.prepareTableTransfer(tableBytes);
    scope.postMessage({ index: data.index, table }, transfer);
  } catch (error) {
    if (!(error instanceof OptimizationMemoryLimit)) throw error;
    scope.postMessage({ failure: 'resource-limit' });
  }
};
