import { isSpecialGrade, type Board, type BoardNode, type Grade } from './grades.ts';
import type { OptimizationSettings } from './optimizationFeedback';

type OptimizationNode = Omit<BoardNode, 'effectList'>;

export interface OptimizationBoard {
  boardKey: string;
  nodeList: OptimizationNode[];
}

export function toOptimizationBoards(boards: Board[]): OptimizationBoard[] {
  return boards.map(({ boardKey, nodeList }) => ({
    boardKey,
    nodeList: nodeList.map(({ nodeId, row, col, name, grade, type }) => ({ nodeId, row, col, name, grade, type })),
  }));
}

interface GraphNode {
  key: string;
  boardKey: string;
  node: OptimizationNode;
  cost: number;
  neighbors: number[];
}
export interface OptimizationGraph {
  nodes: GraphNode[];
  roots: number[];
  commonNames: string[];
  minimumCosts: number[];
}
export const nodeKey = (boardKey: string, nodeId: number) => `${boardKey}:${nodeId}`;

// No runtime dependency on Vite's data loader: usable by Workers and Node tests.
export function buildGraph(boards: readonly OptimizationBoard[], costs: Record<Grade, number>): OptimizationGraph {
  const nodes: GraphNode[] = [];
  const roots: number[] = [];
  const minimumCosts: number[] = [];
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
      minimumCosts.push(Infinity);
    }
    if (rootCount !== 1) throw new Error('Each board needs one start node');
    for (let i = first; i < nodes.length; i++) {
      const { row, col } = nodes[i].node;
      for (const [r, c] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
        const neighbor = coordinates.get(`${r},${c}`);
        if (neighbor !== undefined) nodes[i].neighbors.push(neighbor);
      }
    }

    // A board has its own start node and no edges to other boards.
    minimumCosts[roots[roots.length - 1]] = 0;
    const pending = new Set(coordinates.values());
    while (pending.size) {
      let current = -1;
      let distance = Infinity;
      for (const index of pending) {
        if (minimumCosts[index] < distance) {
          current = index;
          distance = minimumCosts[index];
        }
      }
      if (current === -1) break;
      pending.delete(current);
      for (const neighbor of nodes[current].neighbors) {
        minimumCosts[neighbor] = Math.min(minimumCosts[neighbor], distance + nodes[neighbor].cost);
      }
    }
  }
  return { nodes, roots, minimumCosts, commonNames: [...new Set(nodes.filter(n => n.node.grade === '일반').map(n => n.node.name))] };
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

export interface SkillRequirement { nodes: number[]; count: number }

export type PreparedInput = { ok: true; required: Set<number>; skills: SkillRequirement[] }
  | { ok: false; kind: 'optimization-failed' | 'unreachable-required' | 'insufficient-points' };

export function prepareInput(graph: OptimizationGraph, settings: OptimizationSettings, classKeys: readonly string[]): PreparedInput {
  const { classKey, availablePoints, commonNodePriority: priority, requiredNodeNames: names, requiredSkillCounts } = settings;
  if (!classKeys.includes(classKey) || !Number.isSafeInteger(availablePoints) || availablePoints < 0
    || !Array.isArray(priority) || graph.commonNames.length !== 6 || priority.length !== 6 || new Set(priority).size !== 6
    || priority.some(name => !graph.commonNames.includes(name)) || !Array.isArray(names)) {
    return { ok: false, kind: 'optimization-failed' };
  }

  const requestedNames = new Set(names);
  const foundNames = new Set<string>();
  const required = new Set<number>();
  const skillNodes = new Map<string, number[]>();
  graph.nodes.forEach(({ node }, index) => {
    if (isSpecialGrade(node.grade) && requestedNames.has(node.name)) {
      foundNames.add(node.name);
      required.add(index);
    }
    if (node.type === 'SkillLevel' && requiredSkillCounts && Object.hasOwn(requiredSkillCounts, node.name)) {
      const indices = skillNodes.get(node.name);
      if (indices) indices.push(index);
      else skillNodes.set(node.name, [index]);
    }
  });
  if (foundNames.size !== names.length) return { ok: false, kind: 'optimization-failed' };

  const skills: SkillRequirement[] = [];
  let skillCost = 0;
  for (const [name, count] of Object.entries(requiredSkillCounts ?? {})) {
    const matching = skillNodes.get(name);
    if (!matching || !Number.isInteger(count) || count < 0 || count > matching.length || requestedNames.has(name)) {
      return { ok: false, kind: 'optimization-failed' };
    }
    if (count === 0) continue;
    const reachable = matching.filter(i => Number.isFinite(graph.minimumCosts[i]));
    if (reachable.length < count) return { ok: false, kind: 'unreachable-required' };
    if (reachable.length === count) reachable.forEach(i => required.add(i));
    else {
      skills.push({ nodes: reachable, count });
      skillCost += reachable.map(i => graph.nodes[i].cost).sort((a, b) => a - b).slice(0, count).reduce((sum, cost) => sum + cost, 0);
    }
  }
  if ([...required].some(i => !Number.isFinite(graph.minimumCosts[i]))) return { ok: false, kind: 'unreachable-required' };
  if ([...required].reduce((sum, i) => sum + graph.nodes[i].cost, skillCost) > availablePoints) return { ok: false, kind: 'insufficient-points' };
  return { ok: true, required, skills };
}
