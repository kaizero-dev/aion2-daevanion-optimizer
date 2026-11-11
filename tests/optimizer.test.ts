import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/optimizationGraph.ts';
import { exhaustiveOracle } from './exhaustiveOracle.ts';
import { optimizeGraph as optimizeFrontier } from '../src/optimizer.ts';

test('frontier DP agrees with all-subset oracle on 400 seeded connected/disconnected multi-board fixtures', () => {
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 400; trial++) {
    const boards = ['a', 'b'].map(boardKey => ({ boardKey, boardName: boardKey, nodeList: Array.from({ length: 6 }, (_, i) => ({
      nodeId: i, row: Math.floor(i / 3), col: i % 3, name: i === 0 ? '' : ['high', 'middle', 'low'][Math.floor(random() * 3)],
      type: i === 0 ? 'Start' : random() < 0.1 ? 'None' : 'Stat', grade: i === 0 ? 'None' : random() < 0.2 ? 'Rare' : 'Common', effectList: [],
    })) }));
    const graph = buildGraph(boards, { Common: 1, Rare: 2, Legend: 3, Unique: 4 });
    const required = new Set(graph.nodes.flatMap((n, i) => n.cost > 0 && random() < 0.12 ? [i] : []));
    const budget = Math.floor(random() * 13);
    const oracle = exhaustiveOracle(graph, budget, required, ['high', 'middle', 'low']);
    const frontier = optimizeFrontier(graph, budget, required, ['high', 'middle', 'low']);
    assert.deepEqual(frontier?.activeKeys ?? null, oracle?.keys ?? null, `frontier trial ${trial}, budget ${budget}`);
    if (frontier) assert.equal(frontier.usedPoints, oracle!.cost);
  }
});

test('point cost precedes special count, and special count breaks only equal-cost ties', () => {
  const n = (id, row, col, name, grade = 'Common', type = 'Stat') => ({ nodeId: id, row, col, name, grade, type, effectList: [] });
  for (const grade of ['Rare', 'Legend']) {
    const graph = buildGraph([{ boardKey: 'a', boardName: '', nodeList: [n(0, 0, 0, '', 'None', 'Start'), n(1, 0, 1, 'special', grade), n(2, 0, 2, 'high'), n(3, 1, 0, 'low'), n(4, 1, 1, 'low'), n(5, 1, 2, 'low'), n(6, 5, 5, 'high')] }], { Common: 1, Rare: 2, Legend: 3, Unique: 4 });
    const result = optimizeFrontier(graph, 4, new Set(), ['high'])!;
    assert.equal(result.usedPoints, grade === 'Rare' ? 3 : 4);
    assert.equal(result.activeKeys.includes('a:1'), grade === 'Rare');
    assert.equal(result.optimizedRanks, 1);
    assert.deepEqual(result.activeKeys, exhaustiveOracle(graph, 4, new Set(), ['high'])!.keys);
  }
});

test('lower ranks improve after an incomplete upper rank without sacrificing its maximum', () => {
  const n = (id, row, col, name, grade = 'Common', type = 'Stat') => ({ nodeId: id, row, col, name, grade, type, effectList: [] });
  const graph = buildGraph([{ boardKey: 'a', boardName: '', nodeList: [n(0, 0, 0, '', 'None', 'Start'), n(1, 0, 1, 'high'), n(2, 0, 2, 'third'), n(3, 0, 3, 'high'), n(4, 1, 0, 'second')] }], { Common: 1, Rare: 2, Legend: 3, Unique: 4 });
  const result = optimizeFrontier(graph, 2, new Set(), ['high', 'second', 'third'])!;
  assert.deepEqual(result.commonCounts, [1, 1, 0]);
  assert.deepEqual(result.activeKeys, ['a:0', 'a:1', 'a:4']);
  assert.equal(result.usedPoints, 2);
  assert.equal(result.optimizedRanks, 3);
});

test('required connecting paths are reselected to obtain a higher-rank target', () => {
  const n = (id, row, col, name, grade = 'Common', type = 'Stat') => ({ nodeId: id, row, col, name, grade, type, effectList: [] });
  const graph = buildGraph([{ boardKey: 'a', boardName: '', nodeList: [n(0, 0, 0, '', 'None', 'Start'), n(1, 0, 1, 'low'), n(2, 1, 0, 'high'), n(3, 1, 1, 'required', 'Rare')] }], { Common: 1, Rare: 2, Legend: 3, Unique: 4 });
  const result = optimizeFrontier(graph, 3, new Set([3]), ['high', 'low'])!;
  assert.deepEqual(result.activeKeys, ['a:0', 'a:2', 'a:3']);
  assert.deepEqual(result.commonCounts, [1, 0]);
});
