import { manifest, costs, getBoards } from './testData.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

import { OptimizationJob } from '../src/optimizationJob.ts';
import { summarizeEffects } from '../src/optimizationEffects.ts';
import { buildGraph, prepareInput } from '../src/optimizationGraph.ts';
import { optimizeGraph } from '../src/optimizer.ts';

const priority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
const settings = { classKey: 'gladiator', availablePoints: 5, requiredNodeNames: [], commonNodePriority: priority };
class FakeWorker {
  onmessage = null; onerror = null; onmessageerror = null;
  terminated = false; message;
  postMessage(message) { this.message = message; }
  terminate() { this.terminated = true; }
}

test('jobs terminate on cancel/recalculation and reject stale, duplicate and mismatched responses', () => {
  const job = new OptimizationJob();
  const first = new FakeWorker(); const second = new FakeWorker();
  const completions = [];
  const input = { ...settings, requiredNodeNames: ['a'], commonNodePriority: [...priority] };
  job.start(input, () => first, (...args) => completions.push(args));
  input.requiredNodeNames.push('b'); input.commonNodePriority.reverse();
  assert.deepEqual(first.message.settings.requiredNodeNames, ['a']);
  assert.deepEqual(first.message.settings.commonNodePriority, priority);
  job.start(settings, () => second, (...args) => completions.push(args));
  assert.ok(first.terminated);
  first.onmessage({ data: { requestId: first.message.requestId, failure: 'optimization-failed' } });
  second.onmessage({ data: { requestId: -1, failure: 'optimization-failed' } });
  assert.equal(completions.length, 0);
  second.onerror({}); second.onerror({});
  assert.ok(second.terminated);
  assert.equal(completions.length, 1);
  assert.equal(completions[0][0].failure, 'optimization-failed');
  job.cancel();
  assert.ok(!job.isCurrent(second.message.requestId));
  first.onmessageerror({});
  assert.equal(completions.length, 1);
});

test('worker construction and structured-clone errors become computation failures', () => {
  const job = new OptimizationJob();
  let result;
  job.start(settings, () => { throw new Error('unavailable'); }, response => { result = response; });
  assert.equal(result.failure, 'optimization-failed');
  const worker = new FakeWorker(); worker.postMessage = () => { throw new Error('clone failed'); };
  job.start(settings, () => worker, response => { result = response; });
  assert.ok(worker.terminated);
  assert.equal(result.failure, 'optimization-failed');
});

test('effects aggregate actual numeric effectList values, percentages and skill levels', () => {
  const nodes = [
    { type: 'Start', effectList: [{ desc: '공격력 +999' }] },
    { type: 'Stat', effectList: [{ desc: '추가 공격력 +5' }, { desc: '치명타 +10' }, { desc: '피해량 +0.5%' }] },
    { type: 'Stat', effectList: [{ desc: '추가 공격력 +5' }, { desc: '피해량 +1%' }] },
    { type: 'SkillLevel', effectList: [{ desc: '육감 극대화 +1' }] },
    { type: 'SkillLevel', effectList: [{ desc: '육감 극대화 +1' }] },
  ];
  assert.deepEqual(new Set(summarizeEffects(nodes)), new Set(['추가 공격력 +10', '치명타 +10', '피해량 +1.5%', '육감 극대화 +2']));
});

test('all nine classes: real data zero/small budgets, changed priorities and required-node cost failure', async () => {
  const measurements = [];
  for (const c of manifest.classes) {
    const boards = getBoards(c.key);
    const graph = buildGraph(boards, costs);
    for (const budget of [0, 3]) {
      const order = budget ? [...priority].reverse() : priority;
      const start = performance.now();
      const result = optimizeGraph(graph, budget, new Set(), order);
      assert.ok(result);
      assert.ok(result.usedPoints <= budget);
      if (!budget) assert.equal(result.activeKeys.length, 5);
      measurements.push({ classKey: c.key, budget, used: result.usedPoints, ms: Math.round(performance.now() - start) });
    }
    const special = graph.nodes.find(n => n.node.grade === '유일')!.node.name;
    assert.deepEqual(prepareInput(graph, { ...settings, classKey: c.key, availablePoints: 0, requiredNodeNames: [special] }, manifest.classes.map(c => c.key)), { ok: false, kind: 'insufficient-points' });
  }
  console.log('Real-data integration measurements:', JSON.stringify(measurements));
});
