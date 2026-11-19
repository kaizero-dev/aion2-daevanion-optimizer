import { getBoards } from './testData.ts';
import { isSpecialGrade, specialGrades } from '../src/grades.ts';
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
  const { createInitialSettings, defaultPriority, getRequiredNodeOptions, requiredNodeSettings } = loadModule('settingsDefaults.ts', {
    './data': { getBoards }, './grades': { isSpecialGrade, specialGrades },
  }, { localStorage });
  const first = createInitialSettings();
  const expectedRequired = new Set(getBoards('gladiator').flatMap(b => b.nodeList.filter(n => ['유일', '전승', '희귀'].includes(n.grade)).map(n => n.name)));
  assert.equal(first.classKey, 'gladiator');
  assert.equal(first.points, '837');
  assert.deepEqual(new Set(first.required.keys()), expectedRequired);
  assert.deepEqual([...first.priority], [...defaultPriority]);
  const [all, partial, disabled] = new Set(getBoards('gladiator').flatMap(board =>
    board.nodeList.filter(node => node.type === 'SkillLevel' && node.grade === '전승').map(node => node.name)));
  first.required.set(partial, 2);
  first.required.delete(disabled);
  const { requiredNodeNames, requiredSkillCounts } = requiredNodeSettings(first.required);
  assert.ok(requiredNodeNames.includes(all));
  assert.ok(!requiredNodeNames.includes(partial) && !requiredNodeNames.includes(disabled));
  assert.deepEqual(Object.entries(requiredSkillCounts), [[partial, 2]]);
  first.classKey = 'assassin'; first.points = '12'; first.required.clear(); first.priority.reverse();
  const second = createInitialSettings();
  assert.equal(second.classKey, 'gladiator');
  assert.equal(second.points, '837');
  assert.deepEqual(new Set(second.required.keys()), expectedRequired);
  assert.deepEqual([...second.priority], ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항']);
  assert.notEqual(first.required, second.required);
  assert.notEqual(first.priority, second.priority);
  const options = getRequiredNodeOptions('gladiator');
  assert.equal(getRequiredNodeOptions('gladiator'), options);
  assert.notEqual(getRequiredNodeOptions('assassin'), options);
  const boards = getBoards('gladiator');
  for (const [grade, entries] of options) {
    const names = Array.from(entries, ({ node }) => node.name);
    const expected = boards.flatMap(board => board.nodeList.filter(node => node.grade === grade));
    expected.sort((a, b) => Number(a.type === 'SkillLevel') - Number(b.type === 'SkillLevel') || a.name.localeCompare(b.name, 'ko'));
    assert.deepEqual(names, [...new Set(expected.map(node => node.name))]);
    for (const { node, boardNames } of entries) {
      const matching = boards.filter(board => board.nodeList.some(n => n.name === node.name && n.grade === grade));
      assert.deepEqual([...boardNames], matching.map(board => board.boardName));
    }
  }
  assert.equal(storageAccesses, 0);
});
test('each optimization failure shows its corresponding alert', () => {
  const alerts = [];
  const { reportOptimizationFailure } = loadModule('optimizationFeedback.ts', {}, {
    window: { alert: message => alerts.push(message) },
  });
  reportOptimizationFailure('insufficient-points');
  reportOptimizationFailure('unreachable-required');
  reportOptimizationFailure('resource-limit');
  reportOptimizationFailure('optimization-failed');
  assert.deepEqual(alerts, [
    '데바니온 포인트가 부족합니다.',
    '불가능한 노드 설정입니다.',
    '계산량이 너무 많습니다. 스킬 Lv2 지정을 줄여주세요.',
    '최적화에 실패했습니다. 다시 시도해주세요.',
  ]);
});
