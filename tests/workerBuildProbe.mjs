// Exercise the real Vite-built Worker in an isolated Node thread. This validates
// the artifact and protocol; it does not claim browser dialog/DOM verification.
import { Worker } from 'node:worker_threads';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const asset = readdirSync(new URL('../dist/assets/', import.meta.url)).find(name => /^optimization\.worker-.*\.js$/.test(name));
if (!asset) throw new Error('Run npm run build first');
const filename = fileURLToPath(new URL(`../dist/assets/${asset}`, import.meta.url));
const bridge = `const { parentPort } = require('node:worker_threads'); globalThis.self = globalThis; globalThis.postMessage = message => parentPort.postMessage(message); require(${JSON.stringify(filename)}); parentPort.on('message', data => globalThis.onmessage({ data }));`;
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
const boards = manifest.classes[0].boards.map(b => JSON.parse(readFileSync(new URL(`../data/boards/gladiator/${b.key}.json`, import.meta.url), 'utf8')));
const settings = { classKey: 'gladiator', availablePoints: 0, requiredNodeNames: [], commonNodePriority: ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'] };
function request(worker, message) {
  return new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage(message); });
}
const worker = new Worker(bridge, { eval: true });
try {
  const zero = await request(worker, { requestId: 1, settings, boards });
  assert.equal(zero.requestId, 1);
  assert.equal(zero.result.activeKeys.length, 5);
  assert.equal(zero.result.usedPoints, 0);
  const name = boards[0].nodeList.find(n => n.grade === 'Unique').name;
  const failure = await request(worker, { requestId: 2, settings: { ...settings, requiredNodeNames: [name] }, boards });
  assert.equal(failure.failure, 'insufficient-points');
  const invalid = await request(worker, { requestId: 3, settings: { ...settings, classKey: 'invalid' }, boards });
  assert.equal(invalid.failure, 'optimization-failed');
  const start = performance.now();
  const medium = await request(worker, { requestId: 4, settings: { ...settings, availablePoints: 100 }, boards });
  assert.deepEqual(medium.result.commonCounts, [35, 8, 10, 10, 13, 9]);
  assert.equal(medium.result.usedPoints, 100);
  console.log(JSON.stringify({ builtWorker: asset, mediumMs: Math.round(performance.now() - start), status: 'passed' }));
} finally { await worker.terminate(); }
const cancelled = new Worker(bridge, { eval: true });
let received = false;
cancelled.on('message', () => { received = true; });
cancelled.postMessage({ requestId: 5, settings: { ...settings, availablePoints: 1000 }, boards });
await new Promise(resolve => setTimeout(resolve, 100));
await cancelled.terminate();
assert.equal(received, false);
console.log('Built Worker termination during computation: passed');
