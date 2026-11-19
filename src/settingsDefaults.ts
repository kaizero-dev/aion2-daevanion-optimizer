import { getBoards } from './data';
import { isSpecialGrade, specialGrades, type BoardNode, type SpecialGrade } from './grades';
export const defaultPriority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
export type RequiredNodes = Map<string, 'all' | 2>;
export interface RequiredNodeOption { node: BoardNode; boardNames: string[] }
type RequiredNodeOptions = ReadonlyMap<SpecialGrade, readonly RequiredNodeOption[]>;

const optionsByClass = new Map<string, RequiredNodeOptions>();

export function getRequiredNodeOptions(classKey: string): RequiredNodeOptions {
  const cached = optionsByClass.get(classKey);
  if (cached) return cached;

  const locations = new Map(specialGrades.map(grade => [grade, new Map<string, RequiredNodeOption>()]));
  for (const { boardName, nodeList } of getBoards(classKey)) for (const node of nodeList) {
    if (!isSpecialGrade(node.grade)) continue;
    const byName = locations.get(node.grade)!;
    const option = byName.get(node.name) ?? { node, boardNames: [] };
    option.node = node;
    if (!option.boardNames.includes(boardName)) option.boardNames.push(boardName);
    byName.set(node.name, option);
  }
  const options = new Map(specialGrades.map(grade => [
    grade,
    [...locations.get(grade)!.values()].sort(({ node: a }, { node: b }) =>
      Number(a.type === 'SkillLevel') - Number(b.type === 'SkillLevel') || a.name.localeCompare(b.name, 'ko')),
  ]));
  optionsByClass.set(classKey, options);
  return options;
}

export function defaultRequiredNodes(classKey: string): RequiredNodes {
  const required: RequiredNodes = new Map();
  for (const options of getRequiredNodeOptions(classKey).values()) {
    for (const { node } of options) required.set(node.name, 'all');
  }
  return required;
}

export function requiredNodeSettings(required: RequiredNodes) {
  const requiredNodeNames: string[] = [];
  const skillCounts: [string, number][] = [];
  for (const [name, count] of required) {
    if (count === 'all') requiredNodeNames.push(name);
    else skillCounts.push([name, count]);
  }
  return { requiredNodeNames, requiredSkillCounts: Object.fromEntries(skillCounts) };
}
export function createInitialSettings() {
  return { classKey: 'gladiator', points: '837', required: defaultRequiredNodes('gladiator'), priority: [...defaultPriority] };
}
