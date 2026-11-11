import { getBoards } from './data';
export const defaultPriority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
export function defaultRequiredNames(classKey: string): string[] {
  return [...new Set(getBoards(classKey).flatMap(board => board.nodeList.filter(node => ['유일', '전승', '희귀'].includes(node.grade)).map(node => node.name)))];
}
export function createInitialSettings() {
  return { classKey: 'gladiator', points: '837', required: defaultRequiredNames('gladiator'), priority: [...defaultPriority] };
}
