import { readFileSync } from 'node:fs';
import { buildGraph, prepareInput } from '../src/optimizationGraph.ts';
import { optimizeGraph } from '../src/optimizer.ts';
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
const basePriority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
for (const [index, c] of manifest.classes.entries()) {
  const boards = c.boards.map(b => JSON.parse(readFileSync(new URL(`../data/boards/${c.key}/${b.key}.json`, import.meta.url), 'utf8')));
  const graph = buildGraph(boards, manifest.grades);
  const names = [...new Set(graph.nodes.filter(n => n.node.grade === 'Rare').map(n => n.node.name))];
  const requiredName = names.sort((a, b) => graph.nodes.filter(n => n.node.name === a).length - graph.nodes.filter(n => n.node.name === b).length)[0];
  const priority = [...basePriority.slice(index % 6), ...basePriority.slice(0, index % 6)];
  for (const scenario of [
    { budget: 100, requiredNames: [requiredName], priority },
    { budget: 2000, requiredNames: [...new Set(graph.nodes.filter(n => ['Rare', 'Legend', 'Unique'].includes(n.node.grade)).map(n => n.node.name))], priority },
  ]) {
    const prepared = prepareInput(graph, { classKey: c.key, availablePoints: scenario.budget, requiredNodeNames: scenario.requiredNames, commonNodePriority: scenario.priority }, manifest.classes.map(c => c.key));
    if (!prepared.ok) throw new Error(prepared.kind);
    const start = performance.now();
    const result = optimizeGraph(graph, scenario.budget, prepared.required, scenario.priority);
    if (!result) throw new Error('Unexpected infeasibility');
    const active = new Set(result.activeKeys);
    if ([...prepared.required].some(i => !active.has(graph.nodes[i].key))) throw new Error('Missing required');
    if (scenario.budget === 2000 && active.size !== graph.nodes.length) throw new Error('Missing all-node result');
    console.log(JSON.stringify({ classKey: c.key, budget: scenario.budget, requiredCount: prepared.required.size, counts: result.commonCounts, used: result.usedPoints, ms: Math.round(performance.now() - start), rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
  }
  // Required activation costs fit, but their paths do not: prove budget infeasibility.
  const prepared = prepareInput(graph, { classKey: c.key, availablePoints: 100, requiredNodeNames: [requiredName], commonNodePriority: priority }, manifest.classes.map(c => c.key));
  if (!prepared.ok) throw new Error(prepared.kind);
  const ownCost = [...prepared.required].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  if (optimizeGraph(graph, ownCost, prepared.required, priority) !== null) throw new Error('Expected connection budget failure');
}
