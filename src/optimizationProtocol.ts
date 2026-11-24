import type { OptimizationSettings, OptimizationFailure } from './optimizationFeedback';
import type { BoardOptimizationTable, BoardProgress, BoardSolveInput, OptimizationResult, SharedOptimizationBudget } from './optimizer';
import type { OptimizationBoard } from './optimizationGraph';
export interface OptimizationRequest { requestId: number; settings: OptimizationSettings; boards: OptimizationBoard[]; deviceMemoryGiB?: number }
export type OptimizationResponse = { requestId: number; result: OptimizationResult; failure?: never }
  | { requestId: number; failure: OptimizationFailure; result?: never };
export interface OptimizationProgress {
  phase: 'calculating' | 'finalizing';
  memoryRetry: boolean;
  durationSeconds: number | null;
}
export type OptimizationWorkerMessage = OptimizationResponse | { requestId: number; progress: OptimizationProgress };

export type BoardWorkerRequest = {
  memoryLimit: number;
  tableLimit?: number;
  sharedBudget?: SharedOptimizationBudget;
} | { index: number; board: BoardSolveInput };
export type BoardWorkerResponse = { index: number; table: BoardOptimizationTable }
  | { index: number; progress: BoardProgress }
  | { failure: 'resource-limit' };
