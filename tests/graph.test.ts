import { manifest, costs, getBoards as boardsFor } from './testData.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph, prepareInput } from '../src/optimizationGraph.ts';
import { exhaustiveOracle } from './exhaustiveOracle.ts';
const priority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
const settings = (overrides = {}) => ({ classKey: 'assassin', availablePoints: 10000, requiredNodeNames: [], commonNodePriority: [...priority], ...overrides });
const node = (nodeId: number, row: number, col: number, name = '공격력', grade = 'Common', type = 'Stat') => ({ nodeId, row, col, name, grade, type, effectList: [] });
const board = (boardKey: string, nodeList: ReturnType<typeof node>[]) => ({ boardKey, boardName: boardKey, nodeList });
const start = () => node(0, 0, 0, '', 'None', 'Start');

test('all 45 real boards: costs, adjacency, IDs, reachability, totals and valid priorities', () => {
  for (const c of manifest.classes) {
    const graph = buildGraph(boardsFor(c.key), costs);
    assert.equal(graph.roots.length, 5);
    assert.equal(graph.nodes.length, 765);
    assert.equal(new Set(graph.nodes.map(n => n.key)).size, graph.nodes.length);
    assert.equal(graph.nodes.filter(n => n.node.grade === 'Common').length, 610);
    assert.equal(graph.reachable.size, graph.nodes.length);
    assert.ok(prepareInput(graph, settings({ classKey: c.key }), manifest.classes.map(c => c.key)).ok);
    for (const [i, n] of graph.nodes.entries()) {
      assert.equal(n.cost, n.node.type === 'Start' ? 0 : costs[n.node.grade]);
      for (const j of n.neighbors) {
        const other = graph.nodes[j];
        assert.equal(other.boardKey, n.boardKey);
        assert.equal(Math.abs(n.node.row - other.node.row) + Math.abs(n.node.col - other.node.col), 1);
        assert.ok(other.neighbors.includes(i));
      }
    }
  }
});

test('required names expand to four coordinates across three boards and snapshot arrays are copied', () => {
  const graph = buildGraph(boardsFor('assassin'), costs);
  const name = graph.nodes.find(n => n.node.name.includes('육감 극대화'))!.node.name;
  const input = settings({ requiredNodeNames: [name] });
  const prepared = prepareInput(graph, input, ['assassin']);
  assert.ok(prepared.ok);
  assert.equal(prepared.required.size, 4);
  assert.equal(new Set([...prepared.required].map(i => graph.nodes[i].boardKey)).size, 3);
  input.requiredNodeNames.length = 0;
  input.commonNodePriority.reverse();
  assert.deepEqual(prepared.settings.requiredNodeNames, [name]);
  assert.deepEqual(prepared.settings.commonNodePriority, priority);
});

test('invalid budgets, classes, required names and incomplete priorities fail validation', () => {
  const graph = buildGraph(boardsFor('assassin'), costs);
  for (const overrides of [
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, ''].map(availablePoints => ({ availablePoints })),
    { classKey: 'unknown' }, { requiredNodeNames: ['unknown'] }, { requiredNodeNames: ['공격력'] },
    { commonNodePriority: priority.slice(1) }, { commonNodePriority: Array(6).fill('공격력') },
  ]) assert.deepEqual(prepareInput(graph, settings(overrides), ['assassin']), { ok: false, kind: 'optimization-failed' });
  assert.ok(prepareInput(graph, settings({ availablePoints: 0 }), ['assassin']).ok);
});

test('None cells, diagonals and other boards cannot connect nodes; malformed boards rejected', () => {
  const graph = buildGraph([board('a', [start(), node(1, 0, 1, '', 'None', 'None'), node(2, 0, 2), node(3, 1, 1)]), board('b', [start(), node(2, 0, 1)])], costs);
  assert.equal(graph.nodes.length, 5);
  assert.deepEqual([...graph.reachable], [0, 3, 4]);
  for (const nodes of [[start(), start()], [node(1, 0, 1)], [start(), node(1, 0, 0)], [start(), node(1, 0, 1, '', 'Unknown')]]) {
    assert.throws(() => buildGraph([board('a', nodes)], costs));
  }
});

test('unreachable required nodes and required-node cost lower bound have distinct failures', () => {
  const nodes = [start(), ...priority.map((name, i) => node(i + 1, 0, i + 1, name)), node(10, 0, 7, 'required', '희귀')];
  const graph = buildGraph([board('a', nodes)], costs);
  assert.deepEqual(prepareInput(graph, settings({ availablePoints: 1, requiredNodeNames: ['required'] }), ['assassin']), { ok: false, kind: 'insufficient-points' });
  nodes[nodes.length - 1].row = 2;
  assert.deepEqual(prepareInput(buildGraph([board('a', nodes)], costs), settings({ requiredNodeNames: ['required'] }), ['assassin']), { ok: false, kind: 'unreachable-required' });
});

test('oracle respects shared budget and lexicographic rank counts including connecting nodes', () => {
  const graph = buildGraph([board('a', [start(), node(1, 0, 1, 'low'), node(2, 0, 2, 'high'), node(3, 0, 3, 'high'), node(4, 1, 0, 'low')]), board('b', [start(), node(1, 0, 1, 'high')])], costs);
  const result = exhaustiveOracle(graph, 3, new Set(), ['high', 'low'])!;
  assert.deepEqual(result.counts, [2, 1]);
  assert.equal(result.cost, 3);
  assert.equal(exhaustiveOracle(graph, 0, new Set(), ['high', 'low'])!.selected.size, 2);
  assert.equal(exhaustiveOracle(graph, 0, new Set([1]), ['high', 'low']), null);
});

test('oracle minimizes points before special count and uses deterministic ID tie breaking', () => {
  const graph = buildGraph([board('a', [start(), node(1, 0, 1, 'required', '희귀'), node(2, 1, 0, 'required', '희귀'), node(3, 1, 1, 'high'), node(4, 2, 1, 'high')])], costs);
  const result = exhaustiveOracle(graph, 3, new Set(), ['high'])!;
  assert.equal(result.cost, 3);
  assert.equal(result.special, 1);
  assert.deepEqual(result.keys, ['a:0', 'a:1', 'a:3']);
});
