import type { OptimizationSettings, OptimizationFailure } from './optimizationFeedback';
import type { OptimizationResult } from './optimizer';
import type { Board } from './data';
export interface OptimizationRequest { requestId: number; settings: OptimizationSettings; boards: Board[] }
export type OptimizationResponse = { requestId: number; result: OptimizationResult; failure?: never }
  | { requestId: number; failure: OptimizationFailure; result?: never };
