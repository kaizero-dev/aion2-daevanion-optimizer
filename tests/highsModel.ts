import type { OptimizationGraph } from '../src/optimizationGraph.ts';

export type Term = [number, number];
export function expression(terms: Term[]) {
  return terms.filter(([, value]) => value !== 0).map(([i, value]) => `${value < 0 ? '-' : '+'} ${Math.abs(value)} x${i}`).join(' ') || '0 x0';
}

// Single-commodity flow: each selected terminal consumes one unit from its own root.
// With the default terminal set, every selected nonroot consumes one unit.
export function flowConstraints(graph: OptimizationGraph, budget: number, required: Set<number>, terminals = new Set(graph.nodes.map((_, i) => i))) {
  const roots = new Set(graph.roots);
  const lines = [`budget: ${expression(graph.nodes.map((n, i) => [i, n.cost]))} <= ${budget}`];
  const bounds: string[] = [];
  graph.nodes.forEach((n, i) => {
    if (roots.has(i) || required.has(i)) bounds.push(`x${i} = 1`);
    else if (graph.minimumCosts[i] > budget) bounds.push(`x${i} = 0`);
    else bounds.push(`0 <= x${i} <= 1`);
    const members = graph.nodes.flatMap((other, j) => other.boardKey === n.boardKey && !roots.has(j) && terminals.has(j) ? [j] : []);
    const capacity = Math.max(1, Math.min(members.length, budget));
    const incoming = n.neighbors.map(j => `+ f${j}_${i}`).join(' ');
    const outgoing = n.neighbors.map(j => `- f${i}_${j}`).join(' ');
    if (roots.has(i)) lines.push(`balance${i}: ${incoming} ${outgoing} ${expression(members.map(j => [j, 1]))} = 0`);
    else {
      lines.push(`balance${i}: ${incoming} ${outgoing}${terminals.has(i) ? ` - x${i}` : ''} = 0`);
      lines.push(`capacity${i}: ${incoming} - ${capacity} x${i} <= 0`);
      lines.push(`adj${i}: ${expression([[i, -1], ...n.neighbors.map(j => [j, 1] as Term)])} >= 0`);
    }
    for (const j of n.neighbors) bounds.push(`0 <= f${i}_${j} <= ${capacity}`);
  });
  return { lines, bounds };
}

export function lpModel(graph: OptimizationGraph, base: ReturnType<typeof flowConstraints>, objective: Term[], fixed: string[] = [], maximize = true) {
  return `${maximize ? 'Maximize' : 'Minimize'}\nobj: ${expression(objective)}\nSubject To\n${[...base.lines, ...fixed].join('\n')}\nBounds\n${base.bounds.join('\n')}\nBinary\n${graph.nodes.map((_, i) => `x${i}`).join(' ')}\nEnd`;
}
