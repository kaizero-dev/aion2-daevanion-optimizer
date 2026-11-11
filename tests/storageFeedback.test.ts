import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { buildGraph, prepareInput } from '../src/optimizationGraph.ts';
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
const getBoards = key => manifest.classes.find(c => c.key === key).boards.map(b => JSON.parse(readFileSync(new URL(`../data/boards/${key}/${b.key}.json`, import.meta.url), 'utf8')));
function loadModule(file, mocks, globals = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(js, { exports, require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; }, ...globals });
  return exports;
}
test('storage validates current data and preserves blank points and required selections at low budgets', () => {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const { readSettings, saveSettings, defaultPriority } = loadModule('settingsStorage.ts', {
    './data': { classes: manifest.classes, costs: manifest.grades, getBoards }, './optimizationGraph': { buildGraph, prepareInput },
  }, { localStorage });
  const name = getBoards('assassin')[0].nodeList.find(n => n.grade === 'Unique').name;
  const saved = { classKey: 'assassin', points: '', required: [name], priority: [...defaultPriority].reverse() };
  const normalize = value => JSON.parse(JSON.stringify(value));
  saveSettings(saved);
  assert.deepEqual(normalize(readSettings()), saved);
  saveSettings({ ...saved, points: '0' });
  assert.deepEqual(normalize(readSettings().required), [name]);
  for (const patch of [{ points: '-1' }, { points: '1.5' }, { points: 'Infinity' }, { classKey: 'unknown' }, { required: ['deleted'] }, { priority: [] }]) {
    saveSettings({ ...saved, ...patch });
    assert.equal(readSettings().classKey, 'gladiator');
  }
  values.set('daevanion-settings-v1', '{broken');
  assert.equal(readSettings().points, '');
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
