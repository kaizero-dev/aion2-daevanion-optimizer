import { connectedNodes, type OptimizationGraph } from './optimizationGraph.ts';
export interface OptimizationResult {
  activeKeys: string[];
  usedPoints: number;
  commonCounts: number[];
}

export function verifySelection(graph: OptimizationGraph, selected: Set<number>, budget: number, required: Set<number>) {
  if ([...selected].some(i => !graph.nodes[i]) || graph.roots.some(i => !selected.has(i))
    || [...required].some(i => !selected.has(i)) || connectedNodes(graph.nodes, graph.roots, selected).size !== selected.size) throw new Error('Invalid connected selection');
  const usedPoints = [...selected].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  if (usedPoints > budget) throw new Error('Budget exceeded');
  return usedPoints;
}

interface Candidate { score: number; special: number; mask: bigint }
interface StateTable {
  scores: Float64Array;
  specials: Uint32Array;
  masks: (bigint | undefined)[];
  minCost: number;
  maxCost: number;
}
function createTable(limit: number): StateTable {
  return { scores: new Float64Array(limit + 1), specials: new Uint32Array(limit + 1),
    masks: new Array(limit + 1), minCost: limit + 1, maxCost: -1 };
}
interface Step { node: number; previousNeighbors: number[]; keep: number[]; futureGroups: number[]; futureRootMask: number }
interface TransitionScratch { labels: Int32Array; next: Int32Array; components: Int32Array; canonical: Int32Array }

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
function transition(partition: string, step: Step, selected: boolean, root: boolean, scratch: TransitionScratch) {
  const { labels, next, components, canonical } = scratch;
  let maxLabel = 0;
  for (let i = 0; i < partition.length; i++) {
    labels[i] = partition.charCodeAt(i) - 1;
    if (labels[i] > maxLabel) maxLabel = labels[i];
  }
  if (selected) {
    let label = root ? 0 : maxLabel + 1;
    let merged = 0;
    for (const index of step.previousNeighbors) {
      const adjacent = labels[index];
      if (adjacent >= 0) { merged |= 1 << adjacent; if (adjacent < label) label = adjacent; }
    }
    for (let i = 0; i < partition.length; i++) if (labels[i] >= 0 && (merged & (1 << labels[i]))) labels[i] = label;
    labels[partition.length] = label;
    if (label > maxLabel) maxLabel = label;
  } else labels[partition.length] = -1;
  let allLabels = 0, liveLabels = 0;
  for (let i = 0; i <= partition.length; i++) if (labels[i] > 0) allLabels |= 1 << labels[i];
  for (let i = 0; i < step.keep.length; i++) {
    const label = labels[step.keep[i]];
    next[i] = label;
    if (label > 0) liveLabels |= 1 << label;
  }
  if (allLabels & ~liveLabels) return null;
  let selectedMask = 0;
  let reachableMask = 0;
  components.fill(0, 0, maxLabel + 1);
  for (let index = 0; index < step.keep.length; index++) {
    const label = next[index];
    if (label < 0) continue;
    selectedMask |= 1 << index;
    if (label === 0) reachableMask |= 1 << index;
    components[label] |= 1 << index;
  }
  reachableMask |= step.futureRootMask & selectedMask;
  let previousMask = -1;
  while (previousMask !== reachableMask) {
    previousMask = reachableMask;
    for (let label = 0; label <= maxLabel; label++) if (components[label] & reachableMask) reachableMask |= components[label];
    for (const mask of step.futureGroups) if (mask & reachableMask) reachableMask |= mask & selectedMask;
  }
  if (reachableMask !== selectedMask) return null;
  canonical.fill(0, 0, maxLabel + 1);
  let counter = 1;
  let result = '';
  for (let i = 0; i < step.keep.length; i++) {
    const label = next[i];
    if (label <= 0) result += String.fromCharCode(label + 1);
    else {
      if (canonical[label] === 0) canonical[label] = counter++;
      result += String.fromCharCode(canonical[label] + 1);
    }
  }
  return result;
}

export function optimizeGraph(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[], observe?: (states: number) => void): OptimizationResult | null {
  if ([...required].some(i => graph.minimumCosts[i] > budget) || [...required].reduce((sum, i) => sum + graph.nodes[i].cost, 0) > budget) return null;
  const direct = new Set([...graph.roots, ...required, ...graph.nodes.flatMap((n, i) => n.node.grade === '일반' && budget > 0 ? [i] : [])]);
  const directCost = [...direct].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  if (directCost <= budget && connectedNodes(graph.nodes, graph.roots, direct).size === direct.size) {
    // Every objective is attained, or the zero budget admits only free roots.
    return { activeKeys: [...direct].map(i => graph.nodes[i].key).sort(), usedPoints: verifySelection(graph, direct, budget, required),
      commonCounts: priority.map(name => [...direct].filter(i => graph.nodes[i].node.grade === '일반' && graph.nodes[i].node.name === name).length) };
  }
  const boardSteps = [...new Set(graph.nodes.map(n => n.boardKey))].sort().map(key => makeSteps(graph, graph.nodes.flatMap((n, i) => n.boardKey === key ? [i] : [])));
  const roots = new Set(graph.roots);
  // Scratch belongs to this calculation only and never escapes into stored states.
  const scratch: TransitionScratch = { labels: new Int32Array(32), next: new Int32Array(30),
    components: new Int32Array(32), canonical: new Int32Array(32) };
  const sorted = graph.nodes.map((_, i) => i).sort((a, b) => graph.nodes[a].key < graph.nodes[b].key ? -1 : 1);
  const bits = graph.nodes.map(() => 0n);
  sorted.forEach((i, rank) => { bits[i] = 1n << BigInt(sorted.length - rank - 1); });
  // Within a board only its own ID bits are needed. Combine board masks later
  // in the same sorted order, avoiding copies of a full five-board bitset.
  const localBits = graph.nodes.map(() => 0n);
  for (const steps of boardSteps) {
    const members = steps.map(step => step.node).sort((a, b) => graph.nodes[a].key < graph.nodes[b].key ? -1 : 1);
    members.forEach((i, rank) => { localBits[i] = 1n << BigInt(members.length - rank - 1); });
  }
  const limit = Math.min(budget, graph.nodes.reduce((sum, n) => sum + n.cost, 0));
  const forced = new Set([...roots, ...required]);
  // Mixed-radix encoding is exactly equivalent to comparing the count vector
  // lexicographically: every earlier digit exceeds ALL possible later digits.
  // These data-derived place values are not arbitrary preference weights.
  const placeValues = new Map<string, number>();
  let radix = 1;
  for (let rank = priority.length - 1; rank >= 0; rank--) {
    placeValues.set(priority[rank], radix);
    radix *= graph.nodes.filter(n => n.node.grade === '일반' && n.node.name === priority[rank]).length + 1;
    if (!Number.isSafeInteger(radix)) throw new Error('Unsafe exact lexicographic encoding');
  }
  let globalEntries: (Candidate | undefined)[] = [{ score: 0, special: 0, mask: 0n }];
  for (const steps of boardSteps) {
    const localLimit = Math.min(limit, steps.reduce((sum, step) => sum + graph.nodes[step.node].cost, 0));
    const initial = createTable(localLimit);
    initial.masks[0] = 0n; initial.minCost = initial.maxCost = 0;
    let states = new Map<string, StateTable>([['', initial]]);
    for (const step of steps) {
      const i = step.node;
      const n = graph.nodes[i];
      const targetValue = n.node.grade === '일반' ? (placeValues.get(n.node.name) ?? 0) : 0;
      const special = n.cost > 0 && n.node.grade !== '일반' && !required.has(i);
      const nextStates = new Map<string, StateTable>();
      for (const [partition, costs] of states) {
        for (const selected of forced.has(i) ? [true] : graph.minimumCosts[i] > budget ? [false] : [false, true]) {
          const next = transition(partition, step, selected, roots.has(i), scratch);
          if (next === null) continue;
          let entries = nextStates.get(next);
          if (!entries) { entries = createTable(localLimit); nextStates.set(next, entries); }
          for (let cost = costs.minCost; cost <= costs.maxCost; cost++) {
            const sourceMask = costs.masks[cost];
            if (sourceMask === undefined) continue;
            const nextCost = cost + (selected ? n.cost : 0);
            if (nextCost > localLimit) continue;
            const score = costs.scores[cost] + (selected ? targetValue : 0);
            const specials = costs.specials[cost] + Number(selected && special);
            const existingMask = entries.masks[nextCost];
            const existingScore = entries.scores[nextCost];
            const existingSpecials = entries.specials[nextCost];
            if (existingMask !== undefined && (existingScore > score || existingScore === score && existingSpecials < specials)) continue;
            const mask = selected ? sourceMask | localBits[i] : sourceMask;
            if (existingMask !== undefined && existingScore === score && existingSpecials === specials && existingMask >= mask) continue;
            entries.scores[nextCost] = score;
            entries.specials[nextCost] = specials;
            entries.masks[nextCost] = mask;
            if (nextCost < entries.minCost) entries.minCost = nextCost;
            if (nextCost > entries.maxCost) entries.maxCost = nextCost;
          }
        }
      }
      // Same boundary + a cheaper cost + no smaller target score dominates
      // regardless of lower-priority attributes. This is an exact Pareto reduction.
      let stateCount = 0;
      for (const [partition, entries] of nextStates) {
        let bestObjective = -1;
        let firstCost = localLimit + 1, lastCost = -1;
        for (let cost = entries.minCost; cost <= entries.maxCost; cost++) {
          if (entries.masks[cost] === undefined) continue;
          const score = entries.scores[cost];
          if (score <= bestObjective) entries.masks[cost] = undefined;
          else {
            bestObjective = score;
            if (firstCost > cost) firstCost = cost;
            lastCost = cost;
            stateCount++;
          }
        }
        if (lastCost < 0) nextStates.delete(partition);
        else { entries.minCost = firstCost; entries.maxCost = lastCost; }
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
      const prefixMask = first.mask << BigInt(steps.length);
      for (let b = entries.minCost; b <= entries.maxCost && a + b <= limit; b++) {
        const secondMask = entries.masks[b];
        if (secondMask === undefined) continue;
        const score = first.score + entries.scores[b];
        const special = first.special + entries.specials[b];
        const existing = combined[a + b];
        if (existing && (existing.score > score || existing.score === score && existing.special < special)) continue;
        const mask = prefixMask | secondMask;
        if (existing && existing.score === score && existing.special === special && existing.mask >= mask) continue;
        if (existing) { existing.score = score; existing.special = special; existing.mask = mask; }
        else combined[a + b] = { score, special, mask };
      }
    }
    let bestObjective = -1;
    for (let cost = 0; cost < combined.length; cost++) {
      const candidate = combined[cost];
      if (!candidate) continue;
      if (candidate.score <= bestObjective) combined[cost] = undefined;
      else bestObjective = candidate.score;
    }
    globalEntries = combined;
  }
  let winner: Candidate | undefined;
  let usedPoints = 0;
  for (let cost = 0; cost < globalEntries.length; cost++) {
    const candidate = globalEntries[cost];
    if (candidate && (!winner || candidate.score > winner.score)) { winner = candidate; usedPoints = cost; }
  }
  if (!winner) return null;
  const selected = new Set(graph.nodes.flatMap((_, i) => winner!.mask & bits[i] ? [i] : []));
  if (verifySelection(graph, selected, budget, forced) !== usedPoints) throw new Error('Frontier cost mismatch');
  const commonCounts = priority.map(name => [...selected].filter(i => graph.nodes[i].node.grade === '일반' && graph.nodes[i].node.name === name).length);
  const verifiedObjective = commonCounts.reduce((sum, value, rank) => sum + value * placeValues.get(priority[rank])!, 0);
  if (verifiedObjective !== winner.score) throw new Error('Frontier achievement mismatch');
  return { activeKeys: [...selected].map(i => graph.nodes[i].key).sort(), usedPoints, commonCounts };
}
