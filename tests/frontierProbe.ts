import { readFileSync } from 'node:fs';
import { buildGraph } from '../src/optimizationGraph.ts';
import { optimizeGraph as optimizeFrontier } from '../src/optimizer.ts';
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
const c = manifest.classes[0];
const boards = c.boards.map(b => JSON.parse(readFileSync(new URL(`../data/boards/${c.key}/${b.key}.json`, import.meta.url), 'utf8')));
const graph = buildGraph(process.argv.includes('--one-board') ? boards.slice(0, 1) : boards, manifest.grades);
for (const budget of [30, 100, 300, 1000]) {
  let maxStates = 0;
  const start = performance.now();
  const result = optimizeFrontier(graph, budget, new Set(), ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'], states => { maxStates = Math.max(maxStates, states); });
  console.log(JSON.stringify({ budget, counts: result?.commonCounts, used: result?.usedPoints, ms: Math.round(performance.now() - start), maxStates, rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
}
