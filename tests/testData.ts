import { readFileSync } from 'node:fs';
import { createGradeAdapter } from '../src/grades.ts';
export const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
export const adapter = createGradeAdapter(manifest.grades);
export const costs = adapter.costs;
export const getBoards = (key: string) => manifest.classes.find(c => c.key === key).boards.map(b =>
  adapter.normalizeBoard(JSON.parse(readFileSync(new URL(`../data/boards/${key}/${b.key}.json`, import.meta.url), 'utf8'))));
