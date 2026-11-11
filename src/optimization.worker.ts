import manifest from '../data/manifest.json';
import { buildGraph, prepareInput } from './optimizationGraph';
import { optimizeGraph } from './optimizer';
import type { OptimizationRequest, OptimizationResponse } from './optimizationProtocol';

const scope = self as unknown as { onmessage: ((event: MessageEvent<OptimizationRequest>) => void) | null; postMessage: (response: OptimizationResponse) => void };
scope.onmessage = ({ data: { requestId, settings, boards } }) => {
  try {
    const classInfo = manifest.classes.find(c => c.key === settings.classKey);
    if (!classInfo || boards.length !== classInfo.boards.length || classInfo.boards.some(b => !boards.some(board => board.boardKey === b.key))) throw new Error('Invalid class boards');
    const graph = buildGraph(boards, manifest.grades);
    const prepared = prepareInput(graph, settings, manifest.classes.map(c => c.key));
    if (!prepared.ok) { scope.postMessage({ requestId, failure: prepared.kind }); return; }
    const result = optimizeGraph(graph, settings.availablePoints, prepared.required, settings.commonNodePriority);
    scope.postMessage(result ? { requestId, result } : { requestId, failure: 'insufficient-points' });
  } catch {
    scope.postMessage({ requestId, failure: 'optimization-failed' });
  }
};
