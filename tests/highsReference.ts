import { verifySelection, type OptimizationResult } from '../src/optimizer.ts';
import { connectedNodes, type OptimizationGraph } from '../src/optimizationGraph.ts';
import { expression, flowConstraints, lpModel, type Term } from './highsModel.ts';

export interface SolverResult {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, object>;
}
export type ExactSolve = (lp: string) => SolverResult;
// Each objective is solved to proven optimality before adding its equality.
// Only achievements are fixed; paths and individual node choices remain free.
export function optimizeGraph(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[], solve: ExactSolve): OptimizationResult | null {
  function direct(selected: Set<number>, optimizedRanks: number): OptimizationResult {
    return { activeKeys: [...selected].map(i => graph.nodes[i].key).sort(), usedPoints: verifySelection(graph, selected, budget, required),
      commonCounts: priority.map(name => [...selected].filter(i => graph.nodes[i].node.grade === 'Common' && graph.nodes[i].node.name === name).length), optimizedRanks };
  }
  if ([...required].some(i => !graph.reachable.has(i)) || [...required].reduce((sum, i) => sum + graph.nodes[i].cost, 0) > budget) return null;
  if (budget === 0) return direct(new Set(graph.roots), 1);
  // If all objectives and required nodes already form a connected set, this positive-cost
  // lower bound is attained: no other selected node can reduce its cost.
  const allTargets = new Set([...graph.roots, ...required, ...graph.nodes.flatMap((n, i) => n.node.grade === 'Common' ? [i] : [])]);
  if ([...allTargets].reduce((sum, i) => sum + graph.nodes[i].cost, 0) <= budget
    && connectedNodes(graph.nodes, graph.roots, allTargets).size === allTargets.size) return direct(allTargets, priority.length);
  const terminals = new Set(required);
  let base = flowConstraints(graph, budget, required, terminals);
  const fixed: string[] = [];
  let selected = new Set(graph.roots);
  let calls = 0;
  function run(objective: Term[], maximize = true) {
    const result = solve(lpModel(graph, base, objective, fixed, maximize));
    const firstCall = calls++ === 0;
    if (result.Status === 'Infeasible' && firstCall) return null;
    if (result.Status !== 'Optimal') throw new Error(`Unproven solver status: ${result.Status}`);
    const rawSelected = new Set(graph.nodes.flatMap((_, i) => {
      const value = (result.Columns[`x${i}`] as { Primal?: number } | undefined)?.Primal;
      if (value === undefined || !Number.isFinite(value) || Math.abs(value - Math.round(value)) > 1e-5 || value < -1e-5 || value > 1.00001) throw new Error('Invalid integer solution');
      return Math.round(value) === 1 ? [i] : [];
    }));
    // Relay variables with no flow can be freely selected in the relaxed model.
    // Every terminal is rooted by flow; dropping orphan relays preserves all rank
    // objectives. Positive-cost minimization proves there are none in the final optimum.
    selected = connectedNodes(graph.nodes, graph.roots, rawSelected);
    verifySelection(graph, selected, budget, required);
    const value = objective.reduce((sum, [i, coefficient]) => sum + (selected.has(i) ? coefficient : 0), 0);
    if (Math.abs(result.ObjectiveValue - value) > 1e-4) throw new Error('Invalid objective');
    fixed.push(`fixed${fixed.length}: ${expression(objective)} = ${value}`);
    return value;
  }
  let optimizedRanks = 0;
  const achievements: number[] = [];
  for (const name of priority) {
    const group: Term[] = graph.nodes.flatMap((n, i) => n.node.grade === 'Common' && n.node.name === name ? [[i, 1] as Term] : []);
    group.forEach(([i]) => terminals.add(i));
    base = flowConstraints(graph, budget, required, terminals);
    const value = run(group);
    if (value === null) return null;
    achievements.push(value);
    optimizedRanks++;
    if (value < group.length) break;
  }
  run(graph.nodes.map((n, i) => [i, n.cost]), false);
  const special: Term[] = graph.nodes.flatMap((n, i) => n.cost > 0 && n.node.grade !== 'Common' && !required.has(i) ? [[i, 1] as Term] : []);
  if (special.length) run(special, false);
  // Exact binary encoding within a tie-breaking block, never across priority objectives.
  const ids = graph.nodes.map((_, i) => i).filter(i => graph.nodes[i].cost > 0 && !required.has(i) && graph.minimumCosts[i] <= budget)
    .sort((a, b) => graph.nodes[a].key < graph.nodes[b].key ? -1 : 1);
  for (let offset = 0; offset < ids.length; offset += 16) {
    const block = ids.slice(offset, offset + 16);
    run(block.map((i, position) => [i, 2 ** (block.length - position - 1)]));
  }
  const commonCounts = priority.map(name => [...selected].filter(i => graph.nodes[i].node.grade === 'Common' && graph.nodes[i].node.name === name).length);
  if (achievements.some((value, i) => value !== commonCounts[i])) throw new Error('Priority achievement lost');
  return { activeKeys: [...selected].map(i => graph.nodes[i].key).sort(), usedPoints: verifySelection(graph, selected, budget, required), commonCounts, optimizedRanks };
}
