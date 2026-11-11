import { manifest, getBoards } from './testData.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadModule(file, mocks, globals = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(js, { exports, require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; }, ...globals });
  return exports;
}
test('every initialization uses fresh defaults and ignores previously saved settings', () => {
  let storageAccesses = 0;
  const localStorage = new Proxy({}, { get() { storageAccesses++; throw new Error('Storage must not be accessed'); } });
  const { createInitialSettings, defaultPriority } = loadModule('settingsDefaults.ts', {
    './data': { getBoards },
  }, { localStorage });
  const first = createInitialSettings();
  const expectedRequired = new Set(getBoards('gladiator').flatMap(b => b.nodeList.filter(n => ['유일', '전승', '희귀'].includes(n.grade)).map(n => n.name)));
  assert.equal(first.classKey, 'gladiator');
  assert.equal(first.points, '837');
  assert.deepEqual(new Set(first.required), expectedRequired);
  assert.deepEqual([...first.priority], [...defaultPriority]);
  first.classKey = 'assassin'; first.points = '12'; first.required.length = 0; first.priority.reverse();
  const second = createInitialSettings();
  assert.equal(second.classKey, 'gladiator');
  assert.equal(second.points, '837');
  assert.deepEqual(new Set(second.required), expectedRequired);
  assert.deepEqual([...second.priority], ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항']);
  assert.notEqual(first.required, second.required);
  assert.notEqual(first.priority, second.priority);
  assert.equal(storageAccesses, 0);
});
test('failure feedback downloads only computation failure JSON with the failed settings', async () => {
  const events = []; let blob; let link;
  const { reportOptimizationFailure } = loadModule('optimizationFeedback.ts', { '../data/manifest.json': { default: manifest } }, {
    window: { alert: message => events.push(message) }, Blob,
    document: { createElement: () => (link = { href: '', download: '', click: () => events.push('click'), remove: () => events.push('remove') }), body: { append: () => events.push('append') } },
    URL: { createObjectURL(value) { blob = value; events.push('blob'); return 'blob:test'; }, revokeObjectURL() { events.push('revoke'); } },
    setTimeout: callback => { callback(); return 0; },
  });
  const settings = { classKey: 'assassin', availablePoints: 17, requiredNodeNames: ['required'], commonNodePriority: ['priority'] };
  reportOptimizationFailure('insufficient-points', settings);
  reportOptimizationFailure('unreachable-required', settings);
  assert.deepEqual(events, ['데바니온 포인트가 부족합니다.', '불가능한 노드 설정입니다.']);
  events.length = 0;
  reportOptimizationFailure('optimization-failed', settings);
  assert.deepEqual(events, ['최적화가 어렵습니다. 개발자에게 문의하세요.', 'blob', 'append', 'click', 'remove', 'revoke']);
  const json = JSON.parse(await blob.text());
  assert.deepEqual(json.settings, settings);
  assert.equal(json.failure, 'optimization-failed');
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.dataPatchDate, '2026-11-11');
  assert.match(link.download, /^daevanion-settings-.*\.json$/);
});
