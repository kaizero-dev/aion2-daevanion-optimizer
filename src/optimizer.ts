import { connectedNodes, type OptimizationGraph } from './optimizationGraph.ts';
export interface OptimizationResult {
  activeKeys: string[];
  usedPoints: number;
  commonCounts: number[];
  optimizedRanks: number;
}

export function verifySelection(graph: OptimizationGraph, selected: Set<number>, budget: number, required: Set<number>) {
  if ([...selected].some(i => !graph.nodes[i]) || graph.roots.some(i => !selected.has(i))
    || [...required].some(i => !selected.has(i)) || connectedNodes(graph.nodes, graph.roots, selected).size !== selected.size) throw new Error('Invalid connected selection');
  const usedPoints = [...selected].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  if (usedPoints > budget) throw new Error('Budget exceeded');
  return usedPoints;
}

interface Candidate { count: number; special: number; mask: bigint }
interface Step { node: number; previousNeighbors: number[]; keep: number[]; futureGroups: number[]; futureRootMask: number }

function makeSteps(graph: OptimizationGraph, members: number[]): Step[] {
  let order = [...members];
  let bestScore = Infinity;
  // This estimate chooses only the traversal order; it never scores or drops solutions.
  for (const axis of ['row', 'col'] as const) for (const major of [1, -1]) for (const minor of [1, -1]) {
    const other = axis === 'row' ? 'col' : 'row';
    const candidate = [...members].sort((a, b) => major * (graph.nodes[a].node[axis] - graph.nodes[b].node[axis]) || minor * (graph.nodes[a].node[other] - graph.nodes[b].node[other]));
    const position = new Map(candidate.map((i, rank) => [i, rank]));
    const ends = candidate.map(() => 0);
    let live = 0, score = 0;
    candidate.forEach((i, rank) => {
      live -= ends[rank];
      const lastNeighbor = Math.max(-1, ...graph.nodes[i].neighbors.map(j => position.get(j)!));
      if (lastNeighbor > rank) { live++; ends[lastNeighbor]++; }
      score += 5 ** live;
    });
    if (score < bestScore) { bestScore = score; order = candidate; }
  }
  const positions = new Map(order.map((i, position) => [i, position]));
  const last = graph.nodes.map(n => Math.max(-1, ...n.neighbors.map(i => positions.get(i)!)));
  let frontier: number[] = [];
  return order.map((node, position) => {
    const expanded = [...frontier, node];
    const keep = expanded.flatMap((i, index) => last[i] > position ? [index] : []);
    const previousNeighbors = frontier.flatMap((i, index) => graph.nodes[node].neighbors.includes(i) ? [index] : []);
    frontier = keep.map(index => expanded[index]);
    if (frontier.length > 30) throw new Error('Unsupported frontier width');
    const remaining = new Set(order.slice(position + 1));
    const futureGroups: number[] = [];
    let futureRootMask = 0;
    while (remaining.size) {
      const component = [remaining.values().next().value!];
      remaining.delete(component[0]);
      let mask = 0;
      let hasRoot = false;
      for (let head = 0; head < component.length; head++) {
        const i = component[head];
        if (graph.roots.includes(i)) hasRoot = true;
        frontier.forEach((j, index) => { if (graph.nodes[i].neighbors.includes(j)) mask |= 1 << index; });
        for (const j of graph.nodes[i].neighbors) if (remaining.delete(j)) component.push(j);
      }
      if (mask) futureGroups.push(mask);
      if (hasRoot) futureRootMask |= mask;
    }
    return { node, previousNeighbors, keep, futureGroups, futureRootMask };
  });
}

// Labels encode connectivity among the live boundary vertices. Label 0 means
// already connected to a board root; -1 means unselected. Other components may
// close only after merging with a rooted component. No path is fixed in advance.
function transition(partition: string, step: Step, selected: boolean, root: boolean) {
  let labels = Array.from(partition, c => c.charCodeAt(0) - 1);
  if (selected) {
    const adjacent = step.previousNeighbors.map(index => labels[index]).filter(label => label >= 0);
    const label = root ? 0 : adjacent.length ? Math.min(...adjacent) : Math.max(0, ...labels) + 1;
    const merged = new Set(adjacent);
    labels = labels.map(value => merged.has(value) ? label : value);
    labels.push(label);
  } else labels.push(-1);
  const next = step.keep.map(index => labels[index]);
  if (labels.some(label => label > 0 && !next.includes(label))) return null;
  let selectedMask = 0;
  let reachableMask = 0;
  const components = new Map<number, number>();
  next.forEach((label, index) => {
    if (label < 0) return;
    selectedMask |= 1 << index;
    if (label === 0) reachableMask |= 1 << index;
    components.set(label, (components.get(label) ?? 0) | (1 << index));
  });
  reachableMask |= step.futureRootMask & selectedMask;
  let previousMask = -1;
  while (previousMask !== reachableMask) {
    previousMask = reachableMask;
    for (const mask of components.values()) if (mask & reachableMask) reachableMask |= mask;
    for (const mask of step.futureGroups) if (mask & reachableMask) reachableMask |= mask & selectedMask;
  }
  if (reachableMask !== selectedMask) return null;
  const canonical = new Map<number, number>();
  let counter = 1;
  return next.map(label => {
    if (label <= 0) return String.fromCharCode(label + 1);
    if (!canonical.has(label)) canonical.set(label, counter++);
    return String.fromCharCode(canonical.get(label)! + 1);
  }).join('');
}

export function optimizeGraph(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[], observe?: (states: number) => void): OptimizationResult | null {
  if ([...required].some(i => graph.minimumCosts[i] > budget) || [...required].reduce((sum, i) => sum + graph.nodes[i].cost, 0) > budget) return null;
  const direct = new Set([...graph.roots, ...required, ...graph.nodes.flatMap((n, i) => n.node.grade === 'Common' && budget > 0 ? [i] : [])]);
  const directCost = [...direct].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  if (directCost <= budget && connectedNodes(graph.nodes, graph.roots, direct).size === direct.size) {
    // Every objective is attained, or the zero budget admits only free roots.
    return { activeKeys: [...direct].map(i => graph.nodes[i].key).sort(), usedPoints: verifySelection(graph, direct, budget, required),
      commonCounts: priority.map(name => [...direct].filter(i => graph.nodes[i].node.grade === 'Common' && graph.nodes[i].node.name === name).length), optimizedRanks: budget === 0 ? 1 : priority.length };
  }
  const boardSteps = [...new Set(graph.nodes.map(n => n.boardKey))].sort().map(key => makeSteps(graph, graph.nodes.flatMap((n, i) => n.boardKey === key ? [i] : [])));
  const roots = new Set(graph.roots);
  const sorted = graph.nodes.map((_, i) => i).sort((a, b) => graph.nodes[a].key < graph.nodes[b].key ? -1 : 1);
  const bits = graph.nodes.map(() => 0n);
  sorted.forEach((i, rank) => { bits[i] = 1n << BigInt(sorted.length - rank - 1); });
  const limit = Math.min(budget, graph.nodes.reduce((sum, n) => sum + n.cost, 0));
  const forced = new Set([...roots, ...required]);
  let winner: Candidate | undefined;
  let usedPoints = 0;
  let optimizedRanks = 0;
  for (const name of priority) {
    let globalEntries: (Candidate | undefined)[] = [{ count: 0, special: 0, mask: 0n }];
    for (const steps of boardSteps) {
      let states = new Map<string, (Candidate | undefined)[]>([['', [{ count: 0, special: 0, mask: 0n }]]]);
      for (const step of steps) {
        const i = step.node;
        const n = graph.nodes[i];
        const target = n.node.grade === 'Common' && n.node.name === name;
        const special = n.cost > 0 && n.node.grade !== 'Common' && !required.has(i);
        const nextStates = new Map<string, (Candidate | undefined)[]>();
        for (const [partition, costs] of states) {
          for (const selected of forced.has(i) ? [true] : graph.minimumCosts[i] > budget ? [false] : [false, true]) {
            const next = transition(partition, step, selected, roots.has(i));
            if (next === null) continue;
            let entries = nextStates.get(next);
            if (!entries) { entries = []; nextStates.set(next, entries); }
            for (let cost = 0; cost < costs.length; cost++) {
              const candidate = costs[cost];
              if (!candidate) continue;
              const nextCost = cost + (selected ? n.cost : 0);
              if (nextCost > limit) continue;
              const count = candidate.count + Number(selected && target);
              const specials = candidate.special + Number(selected && special);
              const existing = entries[nextCost];
              if (existing && (existing.count > count || existing.count === count && existing.special < specials)) continue;
              const mask = selected ? candidate.mask | bits[i] : candidate.mask;
              if (existing && existing.count === count && existing.special === specials && existing.mask >= mask) continue;
              entries[nextCost] = { count, special: specials, mask };
            }
          }
        }
        // Same boundary + a cheaper cost + no smaller target count dominates
        // regardless of lower-priority attributes. This is an exact Pareto reduction.
        let stateCount = 0;
        for (const [partition, entries] of nextStates) {
          let bestCount = -1;
          let any = false;
          for (let cost = 0; cost < entries.length; cost++) {
            const candidate = entries[cost];
            if (!candidate) continue;
            if (candidate.count <= bestCount) entries[cost] = undefined;
            else { bestCount = candidate.count; any = true; stateCount++; }
          }
          if (!any) nextStates.delete(partition);
        }
        observe?.(stateCount);
        states = nextStates;
        if (!states.size) return null;
      }
      const entries = states.get('');
      if (!entries) return null;
      const combined: (Candidate | undefined)[] = [];
      for (let a = 0; a < globalEntries.length; a++) {
        const first = globalEntries[a];
        if (!first) continue;
        for (let b = 0; b < entries.length && a + b <= limit; b++) {
          const second = entries[b];
          if (!second) continue;
          const count = first.count + second.count;
          const special = first.special + second.special;
          const existing = combined[a + b];
          if (existing && (existing.count > count || existing.count === count && existing.special < special)) continue;
          const mask = first.mask | second.mask;
          if (existing && existing.count === count && existing.special === special && existing.mask >= mask) continue;
          combined[a + b] = { count, special, mask };
        }
      }
      let bestCount = -1;
      for (let cost = 0; cost < combined.length; cost++) {
        const candidate = combined[cost];
        if (!candidate) continue;
        if (candidate.count <= bestCount) combined[cost] = undefined;
        else bestCount = candidate.count;
      }
      globalEntries = combined;
    }
    winner = undefined;
    for (let cost = 0; cost < globalEntries.length; cost++) {
      const candidate = globalEntries[cost];
      if (candidate && (!winner || candidate.count > winner.count)) { winner = candidate; usedPoints = cost; }
    }
    if (!winner) return null;
    optimizedRanks++;
    const group = graph.nodes.flatMap((n, i) => n.node.grade === 'Common' && n.node.name === name ? [i] : []);
    if (winner.count < group.length) break;
    group.forEach(i => forced.add(i));
  }
  if (!winner) throw new Error('No priority groups');
  const selected = new Set(graph.nodes.flatMap((_, i) => winner!.mask & bits[i] ? [i] : []));
  if (verifySelection(graph, selected, budget, forced) !== usedPoints) throw new Error('Frontier cost mismatch');
  const commonCounts = priority.map(name => [...selected].filter(i => graph.nodes[i].node.grade === 'Common' && graph.nodes[i].node.name === name).length);
  if (commonCounts[optimizedRanks - 1] !== winner.count) throw new Error('Frontier achievement mismatch');
  return { activeKeys: [...selected].map(i => graph.nodes[i].key).sort(), usedPoints, optimizedRanks, commonCounts };
}
