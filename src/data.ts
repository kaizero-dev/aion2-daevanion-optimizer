import manifest from '../data/manifest.json';
import { createGradeAdapter, type Board, type BoardNode, type Grade, type SourceBoard } from './grades';
export type { Board, BoardNode, Grade } from './grades';
export { gradeNames, specialGrades } from './grades';

const adapter = createGradeAdapter(manifest.grades);
const sourceModules = import.meta.glob<SourceBoard>('../data/boards/*/*.json', { eager: true, import: 'default' });
const modules = Object.fromEntries(Object.entries(sourceModules).map(([path, board]) => [path, adapter.normalizeBoard(board)]));
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
export const costs = adapter.costs;
export function getBoards(classKey: string): Board[] {
  return classes.find(c => c.key === classKey)!.boards.map(b => modules[`../data/boards/${classKey}/${b.key}.json`]);
}
export function iconFor(node: BoardNode, classKey: string, active = false) {
  const name = node.type === 'Start' ? `start_${classKey}` : `${adapter.sourceGrade(node.grade as Grade).toLowerCase()}${active ? '_open' : ''}`;
  return (node.type === 'Start' ? startIcons : icons)[`../assets/board_icon_${name}.png`];
}
