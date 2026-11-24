import { connectedNodes, type OptimizationGraph, type SkillRequirement } from './optimizationGraph.ts';

const witnessTimeLimitMs = 60;

// A valid connected selection certifies that the top two priorities can both
// reach their maxima. The exact solve still chooses every other node.
export function findSaturatedPriority(graph: OptimizationGraph, budget: number, required: Set<number>,
  priority: string[], skills: SkillRequirement[]): Set<number> | undefined {
  const { nodes, roots, minimumCosts } = graph;
  const targets = new Set(priority.slice(0, 2));
  const fixed = new Set(required);
  nodes.forEach(({ node }, index) => {
    if (node.grade === '일반' && targets.has(node.name)) fixed.add(index);
  });
  if (fixed.size === required.size || [...fixed].some(index => minimumCosts[index] > budget)) return;

  const selected = new Set([...fixed, ...roots]);
  let cost = [...selected].reduce((total, index) => total + nodes[index].cost, 0);
  if (cost > budget) return;
  const distances = new Float64Array(nodes.length);
  const previous = new Int32Array(nodes.length);
  const deadline = performance.now() + witnessTimeLimitMs;
  while (performance.now() < deadline) {
    const connected = connectedNodes(nodes, roots, selected);
    const remaining = new Set([...selected].filter(index => !connected.has(index)));
    if (!remaining.size) {
      for (const skill of skills) {
        const count = skill.nodes.filter(index => selected.has(index)).length;
        if (count < skill.count) for (const index of skill.nodes) if (!selected.has(index)) remaining.add(index);
      }
    }
    if (!remaining.size) return fixed;

    distances.fill(Infinity);
    previous.fill(-1);
    const pending = new Set<number>();
    for (const index of connected) distances[index] = 0;
    const extend = (from: number, distance: number) => {
      for (const neighbor of nodes[from].neighbors) {
        const next = distance + (selected.has(neighbor) ? 0 : nodes[neighbor].cost);
        if (next >= distances[neighbor] || next + cost > budget) continue;
        distances[neighbor] = next;
        previous[neighbor] = from;
        pending.add(neighbor);
      }
    };
    for (const index of connected) extend(index, 0);

    let target = -1;
    while (pending.size) {
      if (performance.now() >= deadline) return;
      let nearest = -1, distance = Infinity;
      for (const index of pending) {
        if (distances[index] >= distance) continue;
        nearest = index;
        distance = distances[index];
      }
      pending.delete(nearest);
      if (remaining.has(nearest)) {
        target = nearest;
        cost += distance;
        break;
      }
      extend(nearest, distance);
    }
    if (target === -1) return;
    for (let index = target; !connected.has(index); index = previous[index]) selected.add(index);
  }
}
