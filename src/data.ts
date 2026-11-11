import manifest from '../data/manifest.json';

export type Grade = 'Common' | 'Rare' | 'Legend' | 'Unique';
export interface BoardNode {
  nodeId: number; row: number; col: number; name: string;
  grade: Grade | 'None'; type: string; effectList: { desc: string }[];
}
export interface Board { boardKey: string; boardName: string; nodeList: BoardNode[] }
const modules = import.meta.glob<Board>('../data/boards/*/*.json', { eager: true, import: 'default' });
const icons = import.meta.glob<string>('../assets/*.png', { eager: true, query: '?url', import: 'default' });
export const classes = manifest.classes;
export const gradeNames: Record<Grade, string> = { Common: '일반', Rare: '희귀', Legend: '전설', Unique: '유일' };
export const costs = manifest.grades;
export function getBoards(classKey: string): Board[] {
  return classes.find(c => c.key === classKey)!.boards.map(b => modules[`../data/boards/${classKey}/${b.key}.json`]);
}
export function iconFor(node: BoardNode, classKey: string) {
  const name = node.type === 'Start' ? `start_${classKey}` : node.grade.toLowerCase();
  return icons[`../assets/board_icon_${name}.png`];
}
