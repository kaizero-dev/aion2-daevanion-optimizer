import manifest from '../data/manifest.json';
import packedBoards from 'virtual:packed-boards';
import { unpackBoard } from './boardPacking';
import { createGradeAdapter, type Board, type BoardNode, type Grade } from './grades';
export type { Board, BoardNode, Grade } from './grades';
export { gradeNames, specialGrades } from './grades';

const adapter = createGradeAdapter(manifest.grades);
const boardsByClass = new Map<string, Board[]>();
const icons = import.meta.glob<string>(['../assets/board_icon_*.webp', '!../assets/board_icon_start_*.webp'], { eager: true, query: '?url', import: 'default' });
// Embed start icons so switching classes never starts a new image download.
const startIcons = import.meta.glob<string>('../assets/board_icon_start_*.webp', { eager: true, query: '?inline', import: 'default' });
const decodedStartIcons: HTMLImageElement[] = [];
const decodedInactiveIcons: HTMLImageElement[] = [];
const decodedOpenIcons: HTMLImageElement[] = [];
export function preloadOpenIcons() {
  if (decodedOpenIcons.length) return;
  for (const [path, src] of Object.entries(icons)) {
    if (!path.endsWith('_open.webp')) continue;
    const image = new Image();
    image.src = src;
    decodedOpenIcons.push(image);
    void image.decode().catch(() => {});
  }
}
export function preloadInactiveIcons() {
  if (decodedInactiveIcons.length) return;
  for (const [path, src] of Object.entries(icons)) {
    if (path.endsWith('_open.webp')) continue;
    const image = new Image();
    image.src = src;
    decodedInactiveIcons.push(image);
    void image.decode().catch(() => {});
  }
}
export function preloadStartIcons() {
  if (decodedStartIcons.length) return;
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
  return (node.type === 'Start' ? startIcons : icons)[`../assets/board_icon_${name}.webp`];
}
