// Exercise the real Vite-built Worker in an isolated Node thread. This validates
// the artifact and protocol; it does not claim browser dialog/DOM verification.
import { Worker } from 'node:worker_threads';
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { toOptimizationBoards } from '../src/optimizationGraph.ts';
import { costs, getBoards } from './testData.ts';
const assets = new URL('../dist/assets/', import.meta.url);
const asset = readdirSync(assets).find(name => /^optimization\.worker-.*\.js$/.test(name));
if (!asset) throw new Error('Run npm run build first');
const bridge = `
import { Worker, parentPort, workerData } from 'node:worker_threads';

Object.defineProperty(navigator, 'hardwareConcurrency', { value: 3 });
Object.defineProperty(globalThis, 'crossOriginIsolated', { value: workerData.crossOriginIsolated ?? false });
globalThis.self = {
  location: { href: new URL(workerData.asset, 'http://localhost/assets/').href },
  postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
};
globalThis.Worker = class {
  constructor(url) {
    const asset = url.pathname.split('/').at(-1);
    this.thread = new Worker(new URL(workerData.bridge), { workerData: { ...workerData, asset } });
    this.thread.on('message', data => {
      if ('table' in data) {
        this.completed = true;
        parentPort.postMessage({ boardTable: true });
      }
      this.onmessage({ data });
    });
    this.thread.on('error', error => this.onerror?.(error));
    this.thread.on('messageerror', error => this.onmessageerror?.(error));
  }
  postMessage(data) {
    if ('memoryLimit' in data) {
      this.initial = data;
      if (data.sharedBudget) parentPort.postMessage({ sharedBudgetLimit: data.sharedBudget.limit });
    }
    if (workerData.holdOtherBoards && 'index' in data && data.index !== 0) return;
    if (workerData.forceMemoryLimit && this.completed && 'index' in data) {
      this.thread.postMessage({ ...this.initial, memoryLimit: 1 });
    }
    this.thread.postMessage(data);
  }
  terminate() { this.thread.terminate(); }
};

await import(new URL(workerData.asset, workerData.assets));
parentPort.on('message', data => {
  if (!workerData.ignoreRequests) self.onmessage({ data });
});
`;
const bridgeUrl = new URL('data:text/javascript;base64,' + Buffer.from(bridge).toString('base64'));
function createWorker(options = {}) {
  return new Worker(bridgeUrl, { workerData: { assets: assets.href, asset, bridge: bridgeUrl.href, ...options } });
}
const boards = toOptimizationBoards(getBoards('gladiator'));
const settings = { classKey: 'gladiator', availablePoints: 0, requiredNodeNames: [], commonNodePriority: ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'] };
function request(worker, message, { timeoutMs = 30_000, waitForProgress = false } = {}) {
  return new Promise((resolve, reject) => {
    let boardTables = 0;
    let memoryRetry = false;
    let finalizing = false;
    const sharedBudgets = [];
    const awaited = waitForProgress ? 'progress' : 'result';
    const timeout = setTimeout(() =>
      onError(new Error(`Worker request ${message.requestId} timed out waiting for ${awaited} after ${timeoutMs}ms`)), timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('messageerror', onError);
      worker.off('exit', onExit);
    }
    function onMessage(data) {
      if (data.boardTable) { boardTables++; return; }
      if ('sharedBudgetLimit' in data) { sharedBudgets.push(data.sharedBudgetLimit); return; }
      if (data.requestId !== message.requestId) return;
      if ('progress' in data) {
        memoryRetry ||= data.progress.memoryRetry;
        finalizing ||= data.progress.phase === 'finalizing';
        if (!waitForProgress) return;
      }
      cleanup();
      resolve({ ...data, boardTables, memoryRetry, finalizing, sharedBudgets });
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onExit(code) {
      onError(new Error(`Worker exited with code ${code} before request ${message.requestId} sent ${awaited}`));
    }
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('messageerror', onError);
    worker.once('exit', onExit);
    try { worker.postMessage(message); }
    catch (error) { onError(error); }
  });
}
const worker = createWorker();
try {
  const zero = await request(worker, { requestId: 1, settings, boards });
  assert.equal(zero.requestId, 1);
  assert.equal(zero.result.activeKeys.length, 5);
  assert.equal(zero.result.usedPoints, 0);
  const name = boards[0].nodeList.find(n => costs[n.grade] === 4).name;
  const failure = await request(worker, { requestId: 2, settings: { ...settings, requiredNodeNames: [name] }, boards });
  assert.equal(failure.failure, 'insufficient-points');
  const invalid = await request(worker, { requestId: 3, settings: { ...settings, classKey: 'invalid' }, boards });
  assert.equal(invalid.failure, 'optimization-failed');
  const start = performance.now();
  const medium = await request(worker, { requestId: 4, settings: { ...settings, availablePoints: 100 }, boards });
  assert.deepEqual(medium.result.commonCounts, [35, 8, 10, 10, 13, 9]);
  assert.equal(medium.result.usedPoints, 100);
  console.log(JSON.stringify({ builtWorker: asset, mediumMs: Math.round(performance.now() - start), status: 'passed' }));
  const allRequired = [...new Set(boards.flatMap(board => board.nodeList.filter(node => costs[node.grade] > 1).map(node => node.name)))];
  const defaults = await request(worker, { requestId: 5, settings: { ...settings, availablePoints: 837, requiredNodeNames: allRequired }, boards });
  assert.ok(defaults.result, JSON.stringify(defaults));
  assert.equal(defaults.finalizing, true);
  assert.ok(defaults.result.usedPoints <= 837);
  const active = new Set(defaults.result.activeKeys);
  for (const board of boards) for (const node of board.nodeList) {
    if (costs[node.grade] > 1) assert.ok(active.has(`${board.boardKey}:${node.nodeId}`));
  }
  console.log('Default 837P with all special nodes required: passed');
  const parallel = await request(worker, {
    requestId: 6, deviceMemoryGiB: 8, settings: { ...settings, availablePoints: 837, requiredNodeNames: allRequired }, boards,
  });
  assert.equal(parallel.boardTables, boards.length);
  assert.equal(parallel.finalizing, true);
  assert.deepEqual(parallel.sharedBudgets, []);
  assert.deepEqual(parallel.result, defaults.result);
  console.log('Parallel board transfers match the sequential result: passed');

  const isolatedWorker = createWorker({ crossOriginIsolated: true });
  try {
    for (const [deviceMemoryGiB, expectedBudgetGiB] of [[8, 1.5], [16, 3], [32, 6]]) {
      const shared = await request(isolatedWorker, {
        requestId: deviceMemoryGiB, deviceMemoryGiB, settings: { ...settings, availablePoints: 837, requiredNodeNames: allRequired }, boards,
      });
      assert.equal(shared.boardTables, boards.length);
      assert.deepEqual(shared.sharedBudgets, Array(3).fill(expectedBudgetGiB * 1024 ** 3));
      assert.equal(shared.memoryRetry, false);
      assert.deepEqual(shared.result, defaults.result);
    }
    console.log('Shared worker budget matches the sequential result: passed');

    const partialSkills = ['돌진 일격', '분쇄 파동', '유린의 검', '충격 해제', '공중 결박', '도약 찍기', '발목 베기']
      .map(name => `스킬 레벨 상승 - ${name}`);
    const constrainedSettings = {
      ...settings,
      availablePoints: 837,
      requiredNodeNames: allRequired.filter(name => !partialSkills.includes(name)),
      requiredSkillCounts: Object.fromEntries(partialSkills.map(name => [name, 2])),
    };
    const unknownMemory = await request(worker, {
      requestId: 33, settings: constrainedSettings, boards,
    }, { timeoutMs: 90_000 });
    assert.ok(unknownMemory.result, JSON.stringify(unknownMemory));
    assert.equal(unknownMemory.boardTables, 0);
    assert.equal(unknownMemory.result.usedPoints, 837);
    assert.deepEqual(unknownMemory.result.commonCounts, [103, 102, 99, 65, 45, 25]);
    const constrainedParallel = await request(isolatedWorker, {
      requestId: 34, deviceMemoryGiB: 8, settings: constrainedSettings, boards,
    }, { timeoutMs: 90_000 });
    assert.equal(constrainedParallel.boardTables, boards.length);
    assert.deepEqual(constrainedParallel.result, unknownMemory.result);
    console.log('Seven level-2 skills fit the unknown-memory budget and match the parallel result: passed');
  } finally { await isolatedWorker.terminate(); }
} finally { await worker.terminate(); }
const cancelled = createWorker();
let settled = false;
cancelled.on('message', data => { settled ||= 'result' in data || 'failure' in data; });
try {
  const started = await request(cancelled, { requestId: 7, settings: { ...settings, availablePoints: 1000 }, boards },
    { waitForProgress: true });
  assert.equal(started.progress?.phase, 'calculating');
} finally { await cancelled.terminate(); }
assert.equal(settled, false);
console.log('Built Worker termination during computation: passed');

const unresponsive = createWorker({ ignoreRequests: true });
try {
  for (const waitForProgress of [false, true]) {
    await assert.rejects(request(unresponsive, { requestId: 7, settings, boards }, { timeoutMs: 100, waitForProgress }),
      new RegExp(`timed out waiting for ${waitForProgress ? 'progress' : 'result'}`));
  }
  console.log('Built Worker result and startup waits time out: passed');
} finally { await unresponsive.terminate(); }

const retryWorker = createWorker({ forceMemoryLimit: true });
try {
  const specialNodes = boards.flatMap(board => board.nodeList.filter(node => costs[node.grade] > 1));
  const partial = [...new Set(specialNodes.filter(node => node.type === 'SkillLevel' && costs[node.grade] === 3)
    .map(node => node.name))].slice(0, 2);
  const requestSettings = {
    ...settings, availablePoints: 837,
    requiredNodeNames: [...new Set(specialNodes.map(node => node.name))].filter(name => !partial.includes(name)),
    requiredSkillCounts: Object.fromEntries(partial.map(name => [name, 2])),
  };
  const sequential = await request(retryWorker, { requestId: 8, settings: requestSettings, boards });
  const retry = await request(retryWorker, { requestId: 9, settings: requestSettings, boards, deviceMemoryGiB: 8 });
  assert.ok(retry.boardTables > 0 && retry.boardTables < boards.length);
  assert.ok(retry.memoryRetry);
  assert.equal(retry.finalizing, true);
  assert.ok(sequential.result);
  assert.deepEqual(retry.result, sequential.result);
  console.log('Parallel memory retry with partial board results preserves the constrained result: passed');
} finally { await retryWorker.terminate(); }

const infeasibleWorker = createWorker({ holdOtherBoards: true });
try {
  const node = (nodeId, col, name, grade = '일반', type = 'Stat') => ({ nodeId, row: 0, col, name, grade, type });
  const priority = settings.commonNodePriority;
  const infeasibleBoards = boards.map(({ boardKey }) => boardKey).sort().map((boardKey, index) => ({
    boardKey,
    // Each required endpoint is 3P from the start, but connecting both costs 6P.
    nodeList: index === 0 ? [
      node(0, 2, '', 'None', 'Start'),
      node(1, 1, priority[0]),
      node(2, 0, 'required', '희귀'),
      node(3, 3, priority[1]),
      node(4, 4, 'required', '희귀'),
    ] : [node(0, 0, '', 'None', 'Start'), node(1, 1, priority[index + 1])],
  }));
  const requestSettings = { ...settings, availablePoints: 5, requiredNodeNames: ['required'] };
  const sequential = await request(infeasibleWorker, { requestId: 10, settings: requestSettings, boards: infeasibleBoards }, { timeoutMs: 5000 });
  const parallel = await request(infeasibleWorker, { requestId: 11, settings: requestSettings, boards: infeasibleBoards, deviceMemoryGiB: 8 },
    { timeoutMs: 5000 });
  assert.equal(sequential.failure, 'insufficient-points');
  assert.equal(parallel.failure, sequential.failure);
  assert.equal(parallel.boardTables, 1);
  assert.equal(parallel.memoryRetry, false);
  console.log('Parallel run stops as soon as a board proves the shared budget cannot work: passed');
} finally { await infeasibleWorker.terminate(); }
