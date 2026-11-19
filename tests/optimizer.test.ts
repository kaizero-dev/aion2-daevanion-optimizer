import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/optimizationGraph.ts';
import { exhaustiveOracle } from './exhaustiveOracle.ts';
import { boardTableBytes, createBoardSolver, createOptimizationPlan, OptimizationMemoryLimit, optimizeGraph as optimizeFrontier, optimizeSkillRequirements } from '../src/optimizer.ts';

test('a two-node skill requirement chooses board locations together with common-node priorities', () => {
  const graph = buildGraph(['a', 'b', 'c', 'd'].map((boardKey, index) => ({
    boardKey,
    boardName: boardKey,
    nodeList: [
      { nodeId: 0, row: 0, col: 0, name: '', type: 'Start', grade: 'None', effectList: [] },
      { nodeId: 1, row: 0, col: 1, name: 'skill', type: 'SkillLevel', grade: '희귀', effectList: [] },
      { nodeId: 2, row: 0, col: 2, name: index < 2 ? 'low' : 'high', type: 'Stat', grade: '일반', effectList: [] },
    ],
  })), { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  const nodes = graph.nodes.flatMap((n, i) => n.node.type === 'SkillLevel' ? [i] : []);
  const required = new Set<number>();
  const result = optimizeSkillRequirements(graph, 6, required, ['high', 'low'], [{ nodes, count: 2 }]);
  assert.deepEqual(result?.activeKeys, ['a:0', 'b:0', 'c:0', 'c:1', 'c:2', 'd:0', 'd:1', 'd:2']);
  const plan = createOptimizationPlan(graph, 6, required, ['high', 'low'], [{ nodes, count: 2 }]);
  assert.ok(plan && 'solveBoard' in plan);
  const used = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const sharedBudget = { used, limit: 16 * 1024 };
  const tables = [undefined, createTable(1), undefined, createTable(3)];
  function createTable(index: number) {
    const worker = createBoardSolver(1, undefined, sharedBudget);
    const table = worker.solveBoard(structuredClone(plan.boards[index]));
    worker.prepareTableTransfer(boardTableBytes(table));
    return table;
  }
  const transferredBytes = boardTableBytes(tables[1]!) + boardTableBytes(tables[3]!);
  assert.equal(Atomics.load(used, 0) * 16, transferredBytes);
  const exhausted = createBoardSolver(Infinity, undefined, { used, limit: transferredBytes });
  assert.throws(() => exhausted.solveBoard(plan.boards[0]), OptimizationMemoryLimit);
  assert.equal(Atomics.load(used, 0) * 16, transferredBytes);
  const calculated: number[] = [];
  assert.deepEqual(plan.finish(index => {
    calculated.push(index);
    return plan.solveBoard(index);
  }, tables), result);
  assert.deepEqual(calculated, [0, 2]);
  const limited = createOptimizationPlan(graph, 6, required, ['high', 'low'], [{ nodes, count: 2 }], { memoryLimit: 1 });
  assert.ok(limited && 'solveBoard' in limited);
  assert.throws(() => limited.finish(limited.solveBoard), OptimizationMemoryLimit);
  const tight = optimizeSkillRequirements(graph, 4, required, ['high', 'low'], [{ nodes, count: 2 }]);
  assert.deepEqual(tight?.activeKeys, ['a:0', 'a:1', 'b:0', 'b:1', 'c:0', 'd:0']);
  assert.equal(optimizeSkillRequirements(graph, 3, required, ['high', 'low'], [{ nodes, count: 2 }]), null);
});

test('shared point shortages stop planning or merging as soon as they are proven', () => {
  const root = { nodeId: 0, row: 0, col: 0, name: '', type: 'Start', grade: 'None' };
  const connector = { nodeId: 1, row: 0, col: 1, name: 'common', type: 'Stat', grade: '일반' };
  const endpoint = { nodeId: 2, row: 0, col: 2, name: 'required', type: 'Stat', grade: '희귀' };
  const graph = buildGraph([
    { boardKey: 'a', nodeList: [root, connector, endpoint, { ...connector, nodeId: 3, col: -1 }, { ...endpoint, nodeId: 4, col: -2 }] },
    { boardKey: 'b', nodeList: [root, connector, endpoint] },
    { boardKey: 'c', nodeList: [root, connector] },
  ], { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  const required = new Set(graph.nodes.flatMap(({ node }, index) => node.name === endpoint.name ? [index] : []));
  assert.equal(createOptimizationPlan(graph, 6, required, [connector.name], []), null);
  const plan = createOptimizationPlan(graph, 8, required, [connector.name], []);
  assert.ok(plan && 'solveBoard' in plan);

  const calculated: number[] = [];
  assert.equal(plan.finish(index => {
    calculated.push(index);
    return plan.solveBoard(index);
  }), null);
  assert.deepEqual(calculated, [0, 1]);
});

test('frontier DP agrees with all-subset oracle on 400 seeded connected/disconnected multi-board fixtures', () => {
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 400; trial++) {
    const boards = ['a', 'b'].map(boardKey => ({ boardKey, boardName: boardKey, nodeList: Array.from({ length: 6 }, (_, i) => ({
      nodeId: i, row: Math.floor(i / 3), col: i % 3, name: i === 0 ? '' : ['high', 'middle', 'low'][Math.floor(random() * 3)],
      type: i === 0 ? 'Start' : random() < 0.1 ? 'None' : 'Stat', grade: i === 0 ? 'None' : random() < 0.2 ? '희귀' : '일반', effectList: [],
    })) }));
    const graph = buildGraph(boards, { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
    const required = new Set(graph.nodes.flatMap((n, i) => n.cost > 0 && random() < 0.12 ? [i] : []));
    const budget = Math.floor(random() * 13);
    const oracle = exhaustiveOracle(graph, budget, required, ['high', 'middle', 'low']);
    const frontier = optimizeFrontier(graph, budget, required, ['high', 'middle', 'low']);
    assert.deepEqual(frontier?.activeKeys ?? null, oracle?.keys ?? null, `frontier trial ${trial}, budget ${budget}`);
    if (frontier) assert.equal(frontier.usedPoints, oracle!.cost);
    const skills = ['high', 'middle'].flatMap(name => {
      const nodes = graph.nodes.flatMap((n, i) => n.node.grade === '희귀' && n.node.name === name ? [i] : []);
      return nodes.length ? [{ nodes, count: 1 }] : [];
    });
    if (!skills.length) continue;
    const constrainedOracle = exhaustiveOracle(graph, budget, required, ['high', 'middle', 'low'], skills);
    const constrainedFrontier = optimizeSkillRequirements(graph, budget, required, ['high', 'middle', 'low'], skills);
    assert.deepEqual(constrainedFrontier?.activeKeys ?? null, constrainedOracle?.keys ?? null, `skill counts trial ${trial}`);
    const plan = createOptimizationPlan(graph, budget, required, ['high', 'middle', 'low'], skills, { memoryLimit: 2 ** 20 });
    const adaptive = plan && 'solveBoard' in plan ? plan.finish(plan.solveBoard) : plan;
    assert.deepEqual(adaptive, constrainedFrontier, `memory-limited traversal trial ${trial}`);
  }
});

test('point cost precedes special count, and special count breaks only equal-cost ties', () => {
  const n = (id, row, col, name, grade = '일반', type = 'Stat') => ({ nodeId: id, row, col, name, grade, type, effectList: [] });
  for (const grade of ['희귀', '전승']) {
    const graph = buildGraph([{ boardKey: 'a', boardName: '', nodeList: [n(0, 0, 0, '', 'None', 'Start'), n(1, 0, 1, 'special', grade), n(2, 0, 2, 'high'), n(3, 1, 0, 'low'), n(4, 1, 1, 'low'), n(5, 1, 2, 'low'), n(6, 5, 5, 'high')] }], { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
    const result = optimizeFrontier(graph, 4, new Set(), ['high'])!;
    assert.equal(result.usedPoints, grade === '희귀' ? 3 : 4);
    assert.equal(result.activeKeys.includes('a:1'), grade === '희귀');
    assert.deepEqual(result.activeKeys, exhaustiveOracle(graph, 4, new Set(), ['high'])!.keys);
  }
});

test('direct selection minimizes points when only some common nodes are ranked', () => {
  const graph = buildGraph([{ boardKey: 'a', nodeList: [
    { nodeId: 0, row: 0, col: 0, name: '', type: 'Start', grade: 'None' },
    { nodeId: 1, row: 0, col: 1, name: 'high', type: 'Stat', grade: '일반' },
    { nodeId: 2, row: 1, col: 0, name: 'unranked', type: 'Stat', grade: '일반' },
  ] }], { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  assert.deepEqual(optimizeFrontier(graph, 2, new Set(), ['high']), {
    activeKeys: ['a:0', 'a:1'], usedPoints: 1, commonCounts: [1],
  });
  assert.deepEqual(optimizeFrontier(graph, 2, new Set([2]), ['high']), {
    activeKeys: ['a:0', 'a:1', 'a:2'], usedPoints: 2, commonCounts: [1],
  });
});

test('lower ranks improve after an incomplete upper rank without sacrificing its maximum', () => {
  const n = (id, row, col, name, grade = '일반', type = 'Stat') => ({ nodeId: id, row, col, name, grade, type, effectList: [] });
  const graph = buildGraph([{ boardKey: 'a', boardName: '', nodeList: [n(0, 0, 0, '', 'None', 'Start'), n(1, 0, 1, 'high'), n(2, 0, 2, 'third'), n(3, 0, 3, 'high'), n(4, 1, 0, 'second')] }], { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  const result = optimizeFrontier(graph, 2, new Set(), ['high', 'second', 'third'])!;
  assert.deepEqual(result.commonCounts, [1, 1, 0]);
  assert.deepEqual(result.activeKeys, ['a:0', 'a:1', 'a:4']);
  assert.equal(result.usedPoints, 2);
});

test('required connecting paths are reselected to obtain a higher-rank target', () => {
  const n = (id, row, col, name, grade = '일반', type = 'Stat') => ({ nodeId: id, row, col, name, grade, type, effectList: [] });
  const graph = buildGraph([{ boardKey: 'a', boardName: '', nodeList: [n(0, 0, 0, '', 'None', 'Start'), n(1, 0, 1, 'low'), n(2, 1, 0, 'high'), n(3, 1, 1, 'required', '희귀')] }], { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  const result = optimizeFrontier(graph, 3, new Set([3]), ['high', 'low'])!;
  assert.deepEqual(result.activeKeys, ['a:0', 'a:2', 'a:3']);
  assert.deepEqual(result.commonCounts, [1, 0]);
});

test('shared-budget ID ties stay deterministic across unequal boards supplied in reverse order', () => {
  const n = (nodeId, row, col, name, type = 'Stat') => ({ nodeId, row, col, name, type, grade: type === 'Start' ? 'None' : '일반', effectList: [] });
  const graph = buildGraph([
    { boardKey: 'z', boardName: '', nodeList: [n(100, 0, 0, '', 'Start'), n(2, 0, 1, 'high'), n(10, 1, 0, 'high'), n(3, 0, 2, 'low')] },
    { boardKey: 'a', boardName: '', nodeList: [n(9, 0, 0, '', 'Start'), n(50, 0, 1, 'high')] },
  ], { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  const result = optimizeFrontier(graph, 2, new Set(), ['high', 'low'])!;
  assert.deepEqual(result.activeKeys, ['a:50', 'a:9', 'z:10', 'z:100']);
  assert.deepEqual(result.activeKeys, exhaustiveOracle(graph, 2, new Set(), ['high', 'low'])!.keys);
  assert.deepEqual(result.commonCounts, [2, 0]);
});

test('mask encoding and decoding agree when board keys share a prefix', () => {
  for (const secondKey of ['a-', 'a:0']) {
    const graph = buildGraph([secondKey, 'a'].map(boardKey => ({
      boardKey, boardName: boardKey, nodeList: [
        { nodeId: 0, row: 0, col: 0, name: '', type: 'Start', grade: 'None', effectList: [] },
        { nodeId: 1, row: 0, col: 1, name: boardKey === 'a' ? 'high' : 'low', type: 'Stat', grade: '일반', effectList: [] },
      ],
    })), { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
    const required = new Set<number>();
    const priority = ['high', 'low'];
    const expected = exhaustiveOracle(graph, 1, required, priority)!;
    const result = optimizeFrontier(graph, 1, required, priority)!;
    assert.deepEqual(result.activeKeys, expected.keys);
    assert.equal(result.usedPoints, expected.cost);
    assert.deepEqual(result.commonCounts, [1, 0]);
  }
});

test('unused pooled arrays can be released to complete within the memory limit', () => {
  const priority = ['high', 'middle', 'low'];
  const graph = buildGraph(Array.from({ length: 3 }, (_, board) => ({
    boardKey: `board${board}`, boardName: '', nodeList: Array.from({ length: 20 }, (_, i) => ({
      nodeId: i, row: Math.floor(i / 5), col: i % 5, name: i === 0 ? '' : priority[(i + board) % 3],
      type: i === 0 ? 'Start' : 'Stat', grade: i === 0 ? 'None' : i % 7 === 0 ? '희귀' : '일반', effectList: [],
    })),
  })), { 일반: 1, 희귀: 2, 전승: 3, 유일: 4 });
  const required = new Set<number>();
  const result = optimizeFrontier(graph, 20, required, priority);
  const plan = createOptimizationPlan(graph, 20, required, priority, [], { memoryLimit: 70_624 });
  assert.ok(result && plan && 'solveBoard' in plan);
  assert.deepEqual(plan.finish(plan.solveBoard), result);
});
