import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { adapter, costs, getBoards, manifest } from './testData.ts';
import { summarizeEffects } from '../src/optimizationEffects.ts';
import { specialGrades } from '../src/grades.ts';

test('source grades normalize without changing node IDs, costs, effects or original icon files', () => {
  assert.deepEqual(costs, { Common: 1, 희귀: 2, 전승: 3, 유일: 4 });
  for (const grade of ['Common', ...specialGrades]) {
    const source = adapter.sourceGrade(grade).toLowerCase();
    for (const suffix of ['', '_open']) assert.ok(existsSync(new URL(`../assets/board_icon_${source}${suffix}.png`, import.meta.url)));
  }
  for (const c of manifest.classes) {
    const boards = getBoards(c.key);
    for (const [index, descriptor] of c.boards.entries()) {
      const raw = JSON.parse(readFileSync(new URL(`../data/boards/${c.key}/${descriptor.key}.json`, import.meta.url), 'utf8'));
      assert.deepEqual(adapter.normalizeBoard(boards[index]), boards[index]);
      raw.nodeList.forEach((node, i) => {
        const normalized = boards[index].nodeList[i];
        assert.equal(normalized.nodeId, node.nodeId);
        assert.deepEqual(normalized.effectList, node.effectList);
        if (node.type !== 'None' && node.type !== 'Start') assert.equal(costs[normalized.grade], manifest.grades[node.grade]);
      });
    }
  }
});

test('effects show stats before skills, each by grade then name, while preserving cross-grade totals', () => {
  const node = (type, grade, desc) => ({ type, grade, effectList: [{ desc }] });
  const nodes = [
    node('SkillLevel', '유일', '유일 스킬 +1'), node('Stat', '희귀', '희귀 스탯 +2'),
    node('SkillLevel', '희귀', '희귀 스킬 +1'), node('Stat', 'Common', '일반 스탯 +3'),
    node('Stat', '전승', '전승 스탯 +4'), node('SkillLevel', '전승', '전승 스킬 +1'),
    node('Stat', '유일', '유일 스탯 +5'), node('Stat', 'Common', '유일 스탯 +6'),
    node('Stat', '유일', '가나다 스탯 +1'), node('SkillLevel', '유일', '유일 스킬 +1'),
  ];
  assert.deepEqual(summarizeEffects(nodes), ['가나다 스탯 +1', '유일 스탯 +11', '전승 스탯 +4', '희귀 스탯 +2', '일반 스탯 +3', '유일 스킬 +2', '전승 스킬 +1', '희귀 스킬 +1']);
  assert.deepEqual(summarizeEffects([...nodes].reverse()), summarizeEffects(nodes));
});
