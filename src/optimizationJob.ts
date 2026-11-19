import type { OptimizationSettings } from './optimizationFeedback';
import type { OptimizationProgress, OptimizationRequest, OptimizationResponse, OptimizationWorkerMessage } from './optimizationProtocol';
import type { Board } from './grades';
import { toOptimizationBoards } from './optimizationGraph.ts';
interface JobWorker {
  onmessage: ((event: MessageEvent<OptimizationWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage: (message: OptimizationRequest) => void;
  terminate: () => void;
}
export class OptimizationJob {
  private serial = 0;
  private worker: JobWorker | undefined;
  cancel() { this.serial++; this.worker?.terminate(); this.worker = undefined; }
  isCurrent(id: number) { return this.serial === id; }
  start(settings: OptimizationSettings, create: () => JobWorker, done: (response: OptimizationResponse) => void,
    boards: Board[] = [], onProgress?: (progress: OptimizationProgress) => void) {
    this.cancel();
    const requestId = this.serial;
    let settled = false;
    const finish = (response: OptimizationResponse) => {
      if (settled || !this.isCurrent(requestId) || response.requestId !== requestId) return;
      settled = true;
      this.worker?.terminate(); this.worker = undefined;
      done(response);
    };
    try {
      const worker = create();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (!('progress' in data)) { finish(data); return; }
        if (!settled && this.isCurrent(requestId) && data.requestId === requestId) onProgress?.(data.progress);
      };
      worker.onerror = () => finish({ requestId, failure: 'optimization-failed' });
      worker.onmessageerror = () => finish({ requestId, failure: 'optimization-failed' });
      const deviceMemoryGiB = (globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
      worker.postMessage({ requestId, settings, boards: toOptimizationBoards(boards), deviceMemoryGiB });
    } catch { finish({ requestId, failure: 'optimization-failed' }); }
  }
}
