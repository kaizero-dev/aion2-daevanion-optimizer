import type { Board, BoardNode, Grade } from './data';
import type { OptimizationSettings } from './optimizationFeedback';

export interface GraphNode {
  key: string;
  boardKey: string;
  node: BoardNode;
  cost: number;
  neighbors: number[];
}
export interface OptimizationGraph {
  nodes: GraphNode[];
  roots: number[];
  reachable: Set<number>;
  commonNames: string[];
  minimumCosts: number[];
}
export const nodeKey = (boardKey: string, nodeId: number) => `${boardKey}:${nodeId}`;

// No runtime dependency on Vite's data loader: usable by Workers and Node tests.
export function buildGraph(boards: Board[], costs: Record<Grade, number>): OptimizationGraph {
  const nodes: GraphNode[] = [];
  const roots: number[] = [];
  const boardKeys = new Set<string>();
  for (const board of boards) {
    if (boardKeys.has(board.boardKey)) throw new Error('Duplicate board key');
    boardKeys.add(board.boardKey);
    const coordinates = new Map<string, number>();
    const ids = new Set<number>();
    const occupied = new Set<string>();
    const first = nodes.length;
    let rootCount = 0;
    for (const node of board.nodeList) {
      const position = `${node.row},${node.col}`;
      if (!Number.isSafeInteger(node.nodeId) || !Number.isSafeInteger(node.row) || !Number.isSafeInteger(node.col)
        || occupied.has(position) || ids.has(node.nodeId)) throw new Error('Invalid board coordinates or IDs');
      occupied.add(position);
      ids.add(node.nodeId);
      if (node.type === 'None') continue;
      const cost = node.type === 'Start' ? 0 : costs[node.grade as Grade];
      if (!Number.isSafeInteger(cost) || cost < 0 || (node.type !== 'Start' && cost === 0)) throw new Error('Invalid node cost');
      coordinates.set(position, nodes.length);
      if (node.type === 'Start') { roots.push(nodes.length); rootCount++; }
      nodes.push({ key: nodeKey(board.boardKey, node.nodeId), boardKey: board.boardKey, node, cost, neighbors: [] });
    }
    if (rootCount !== 1) throw new Error('Each board needs one start node');
    for (let i = first; i < nodes.length; i++) {
      const { row, col } = nodes[i].node;
      for (const [r, c] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
        const neighbor = coordinates.get(`${r},${c}`);
        if (neighbor !== undefined) nodes[i].neighbors.push(neighbor);
      }
    }
  }
  const reachable = connectedNodes(nodes, roots, new Set(nodes.map((_, i) => i)));
  const minimumCosts = nodes.map(() => Infinity);
  roots.forEach(i => { minimumCosts[i] = 0; });
  const pending = new Set(reachable);
  while (pending.size) {
    let current = -1;
    for (const i of pending) if (current === -1 || minimumCosts[i] < minimumCosts[current]) current = i;
    pending.delete(current);
    for (const j of nodes[current].neighbors) minimumCosts[j] = Math.min(minimumCosts[j], minimumCosts[current] + nodes[j].cost);
  }
  return { nodes, roots, reachable, minimumCosts, commonNames: [...new Set(nodes.filter(n => n.node.grade === '일반').map(n => n.node.name))] };
}

export function connectedNodes(nodes: GraphNode[], roots: number[], selected: Set<number>): Set<number> {
  const found = new Set(roots.filter(i => selected.has(i)));
  const queue = [...found];
  for (let head = 0; head < queue.length; head++) {
    for (const i of nodes[queue[head]].neighbors) {
      if (selected.has(i) && !found.has(i)) { found.add(i); queue.push(i); }
    }
  }
  return found;
}

export type PreparedInput = { ok: true; required: Set<number> }
  | { ok: false; kind: 'optimization-failed' | 'unreachable-required' | 'insufficient-points' };

export function prepareInput(graph: OptimizationGraph, settings: OptimizationSettings, classKeys: readonly string[]): PreparedInput {
  const priority = settings.commonNodePriority;
  const names = settings.requiredNodeNames;
  const specialNames = new Set(graph.nodes.filter(n => ['희귀', '전승', '유일'].includes(n.node.grade)).map(n => n.node.name));
  if (!classKeys.includes(settings.classKey) || !Number.isSafeInteger(settings.availablePoints) || settings.availablePoints < 0
    || !Array.isArray(priority) || graph.commonNames.length !== 6 || priority.length !== 6 || new Set(priority).size !== 6
    || priority.some(name => !graph.commonNames.includes(name)) || !Array.isArray(names)
    || new Set(names).size !== names.length || names.some(name => !specialNames.has(name))) {
    return { ok: false, kind: 'optimization-failed' };
  }
  const required = new Set(graph.nodes.flatMap((n, i) => ['희귀', '전승', '유일'].includes(n.node.grade) && names.includes(n.node.name) ? [i] : []));
  if ([...required].some(i => !graph.reachable.has(i))) return { ok: false, kind: 'unreachable-required' };
  if ([...required].reduce((sum, i) => sum + graph.nodes[i].cost, 0) > settings.availablePoints) return { ok: false, kind: 'insufficient-points' };
  return { ok: true, required };
}
