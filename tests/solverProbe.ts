// HiGHS reference benchmark only. The production Worker uses exact frontier DP.
import { readFileSync } from 'node:fs';
import loadHighs from 'highs';
import { buildGraph } from '../src/optimizationGraph.ts';
import { flowConstraints, lpModel } from './highsModel.ts';
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
const c = manifest.classes[0];
const boards = c.boards.map(b => JSON.parse(readFileSync(new URL(`../data/boards/${c.key}/${b.key}.json`, import.meta.url), 'utf8')));
const graph = buildGraph(boards, manifest.grades);
const highs = await loadHighs();
for (const budget of [30, 100, 300]) {
  const objective = graph.nodes.flatMap((n, i) => n.node.grade === 'Common' && n.node.name === '공격력' ? [[i, 1]] : []);
  const terminals = process.argv.includes('--all-nodes') ? undefined : new Set(objective.map(([i]) => i));
  const base = flowConstraints(graph, budget, new Set(), terminals);
  const start = performance.now();
  const result = highs.solve(lpModel(graph, base, objective), { output_flag: false, mip_rel_gap: 0, mip_abs_gap: 0, time_limit: 30 });
  console.log(JSON.stringify({ budget, status: result.Status, objective: result.ObjectiveValue, ms: Math.round(performance.now() - start), rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
}
