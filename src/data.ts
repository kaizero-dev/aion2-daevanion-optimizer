import manifest from '../data/manifest.json';
import packedBoards from 'virtual:packed-boards';
import { unpackBoard } from './boardPacking';
import { createGradeAdapter, type Board, type BoardNode, type Grade } from './grades';
export type { Board, BoardNode, Grade } from './grades';
export { gradeNames } from './grades';

const adapter = createGradeAdapter(manifest.grades);
const boardsByClass = new Map<string, Board[]>();
const openIcons = import.meta.glob<string>('../assets/board_icon_*_open.webp', { eager: true, query: '?url', import: 'default' });
// Embed inactive icons just like start icons to avoid separate image requests.
const inactiveIcons = import.meta.glob<string>(['../assets/board_icon_*.webp', '!../assets/board_icon_start_*.webp', '!../assets/board_icon_*_open.webp'], { eager: true, query: '?inline', import: 'default' });
// Embed start icons so switching classes never starts a new image download.
const startIcons = import.meta.glob<string>('../assets/board_icon_start_*.webp', { eager: true, query: '?inline', import: 'default' });
function createIconPreloader(icons: Record<string, string>) {
  const decoded: HTMLImageElement[] = [];
  return () => {
    if (decoded.length) return;
    for (const src of Object.values(icons)) {
      const image = new Image();
      image.src = src;
      decoded.push(image);
      // Warm the decoded image cache without delaying the initial render.
      void image.decode().catch(() => {});
    }
  };
}
export const preloadOpenIcons = createIconPreloader(openIcons);
export const preloadInactiveIcons = createIconPreloader(inactiveIcons);
export const preloadStartIcons = createIconPreloader(startIcons);
export const classes = manifest.classes;
export const costs = adapter.costs;
export function getBoards(classKey: string): Board[] {
  let boards = boardsByClass.get(classKey);
  if (!boards) {
    boards = classes.find(c => c.key === classKey)!.boards.map(b =>
      adapter.normalizeBoard(unpackBoard(packedBoards, `${classKey}/${b.key}`)));
    boardsByClass.set(classKey, boards);
  }
  return boards;
}
export function iconFor(node: BoardNode, classKey: string, active = false) {
  const name = node.type === 'Start' ? `start_${classKey}` : `${adapter.sourceGrade(node.grade as Grade).toLowerCase()}${active ? '_open' : ''}`;
  return (node.type === 'Start' ? startIcons : active ? openIcons : inactiveIcons)[`../assets/board_icon_${name}.webp`];
}
