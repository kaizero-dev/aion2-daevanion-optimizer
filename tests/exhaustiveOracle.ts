import { connectedNodes, type OptimizationGraph } from '../src/optimizationGraph.ts';

// Independent subset enumeration for tiny fixtures only; never a production fallback.
export function exhaustiveOracle(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[]) {
  const optional = graph.nodes.map((_, i) => i).filter(i => !graph.roots.includes(i));
  if (optional.length > 22) throw new Error('Oracle fixture too large');
  const feasible: { selected: Set<number>; cost: number; counts: number[]; special: number; keys: string[] }[] = [];
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const selected = new Set(graph.roots);
    optional.forEach((i, bit) => { if (mask & (2 ** bit)) selected.add(i); });
    const cost = [...selected].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
    if (cost > budget || [...required].some(i => !selected.has(i))) continue;
    if (connectedNodes(graph.nodes, graph.roots, selected).size !== selected.size) continue;
    const counts = priority.map(name => [...selected].filter(i => graph.nodes[i].node.grade === 'Common' && graph.nodes[i].node.name === name).length);
    const special = [...selected].filter(i => graph.nodes[i].cost > 0 && graph.nodes[i].node.grade !== 'Common' && !required.has(i)).length;
    feasible.push({ selected, cost, counts, special, keys: [...selected].map(i => graph.nodes[i].key).sort() });
  }
  let candidates = feasible;
  for (let rank = 0; rank < priority.length && candidates.length; rank++) {
    const max = Math.max(...candidates.map(c => c.counts[rank]));
    candidates = candidates.filter(c => c.counts[rank] === max);
    if (max < graph.nodes.filter(n => n.node.grade === 'Common' && n.node.name === priority[rank]).length) break;
  }
  // Prefer the lexicographically smallest sorted board-key/node-ID list.
  candidates.sort((a, b) => a.cost - b.cost || a.special - b.special || compareKeys(a.keys, b.keys));
  return candidates[0] ?? null;
}
function compareKeys(a: string[], b: string[]) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}
