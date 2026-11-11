import type { OptimizationSettings } from './optimizationFeedback';
import type { OptimizationRequest, OptimizationResponse } from './optimizationProtocol';
import type { Board } from './data';
export interface JobWorker {
  onmessage: ((event: MessageEvent<OptimizationResponse>) => void) | null;
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
  start(settings: OptimizationSettings, create: () => JobWorker, done: (response: OptimizationResponse, snapshot: OptimizationSettings) => void, boards: Board[] = []) {
    this.cancel();
    const requestId = this.serial;
    let settled = false;
    const snapshot = { ...settings, requiredNodeNames: [...settings.requiredNodeNames], commonNodePriority: [...settings.commonNodePriority] };
    const finish = (response: OptimizationResponse) => {
      if (settled || !this.isCurrent(requestId) || response.requestId !== requestId) return;
      settled = true;
      this.worker?.terminate(); this.worker = undefined;
      done(response, snapshot);
    };
    try {
      const worker = create();
      this.worker = worker;
      worker.onmessage = ({ data }) => finish(data);
      worker.onerror = () => finish({ requestId, failure: 'optimization-failed' });
      worker.onmessageerror = () => finish({ requestId, failure: 'optimization-failed' });
      worker.postMessage({ requestId, settings: snapshot, boards });
    } catch { finish({ requestId, failure: 'optimization-failed' }); }
    return requestId;
  }
}
