import type { SourceBoard } from './grades.ts';

type SourceNode = SourceBoard['nodeList'][number];
type NodeTemplate = [number, number, string, string, string, number];
export interface PackedBoards {
  effects: SourceNode['effectList'][];
  nodes: NodeTemplate[];
  boards: Record<string, [string, string, number[], number[]]>;
}

// Intern exact values only: no assumptions about shared layouts or node IDs.
export function packBoards(boards: Record<string, SourceBoard>): PackedBoards {
  const packed: PackedBoards = { effects: [], nodes: [], boards: {} };
  const effectIds = new Map<string, number>();
  const nodeIds = new Map<string, number>();
  function intern<T>(value: T, values: T[], ids: Map<string, number>) {
    const key = JSON.stringify(value);
    let id = ids.get(key);
    if (id === undefined) { id = values.length; values.push(value); ids.set(key, id); }
    return id;
  }
  for (const [key, board] of Object.entries(boards)) {
    const templates = board.nodeList.map(node => intern<NodeTemplate>([
      node.row, node.col, node.name, node.grade, node.type,
      intern(node.effectList, packed.effects, effectIds),
    ], packed.nodes, nodeIds));
    packed.boards[key] = [board.boardKey, board.boardName, board.nodeList.map(node => node.nodeId), templates];
  }
  return packed;
}

export function unpackBoard(packed: PackedBoards, key: string): SourceBoard {
  const [boardKey, boardName, ids, templates] = packed.boards[key];
  return { boardKey, boardName, nodeList: templates.map((template, index) => {
    const [row, col, name, grade, type, effect] = packed.nodes[template];
    return { nodeId: ids[index], row, col, name, grade, type,
      effectList: packed.effects[effect].map(item => ({ ...item })) };
  }) };
}
