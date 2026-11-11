import manifest from '../data/manifest.json';

export type Grade = 'Common' | 'Rare' | 'Legend' | 'Unique';
export interface BoardNode {
  nodeId: number; row: number; col: number; name: string;
  grade: Grade | 'None'; type: string; effectList: { desc: string }[];
}
export interface Board { boardKey: string; boardName: string; nodeList: BoardNode[] }
const modules = import.meta.glob<Board>('../data/boards/*/*.json', { eager: true, import: 'default' });
const icons = import.meta.glob<string>(['../assets/*.png', '!../assets/board_icon_start_*.png'], { eager: true, query: '?url', import: 'default' });
// Embed start icons so switching classes never starts a new image download.
const startIcons = import.meta.glob<string>('../assets/board_icon_start_*.png', { eager: true, query: '?inline', import: 'default' });
const decodedStartIcons: HTMLImageElement[] = [];
export function preloadStartIcons() {
  for (const src of Object.values(startIcons)) {
    const image = new Image();
    image.src = src;
    decodedStartIcons.push(image);
    // Warm the decoded image cache without delaying the initial render.
    void image.decode().catch(() => {});
  }
}
export const classes = manifest.classes;
export const gradeNames: Record<Grade, string> = { Common: 'Common', Rare: 'Rare', Legend: 'Legend', Unique: 'Unique' };
export const costs = manifest.grades;
export function getBoards(classKey: string): Board[] {
  return classes.find(c => c.key === classKey)!.boards.map(b => modules[`../data/boards/${classKey}/${b.key}.json`]);
}
export function iconFor(node: BoardNode, classKey: string) {
  const name = node.type === 'Start' ? `start_${classKey}` : node.grade.toLowerCase();
  return (node.type === 'Start' ? startIcons : icons)[`../assets/board_icon_${name}.png`];
}
