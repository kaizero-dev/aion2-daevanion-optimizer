import { connectedNodes, type OptimizationGraph, type SkillRequirement } from './optimizationGraph.ts';
export interface OptimizationResult {
  activeKeys: string[];
  usedPoints: number;
  commonCounts: number[];
}

export function optimizeSkillRequirements(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[], skills: SkillRequirement[]) {
  return optimizeWithSkillCounts(graph, budget, required, priority, skills);
}
function verifySelection(graph: OptimizationGraph, selected: Set<number>, budget: number, required: Set<number>) {
  if ([...selected].some(i => !graph.nodes[i]) || graph.roots.some(i => !selected.has(i))
    || [...required].some(i => !selected.has(i)) || connectedNodes(graph.nodes, graph.roots, selected).size !== selected.size) throw new Error('Invalid connected selection');
  const usedPoints = [...selected].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  if (usedPoints > budget) throw new Error('Budget exceeded');
  return usedPoints;
}

interface MergeFrontier {
  costs: Float64Array;
  scores: Float64Array;
  specials: Uint32Array;
  masks: bigint[];
}

function readMask(masks: Uint32Array, slot: number, words: number) {
  let mask = 0n;
  const start = slot * words;
  for (let word = start + words - 1; word >= start; word--) mask = (mask << 32n) | BigInt(masks[word]);
  return mask;
}
interface StateStorage {
  scores: Float64Array;
  // Count plus one. Zero marks an empty cost slot without a separate array.
  specials: Uint32Array;
  // Each cost slot holds consecutive 32-bit words, least-significant first.
  masks: Uint32Array;
}
interface StateTable extends StateStorage {
  offset: number;
  minCost: number;
  maxCost: number;
}
export type BoardOptimizationTable = Map<string, StateTable> | null;
export interface BoardProgress { completedWork: number; totalWork: number }
export interface MergeProgress extends BoardProgress { index: number }

interface BoardSolveNode {
  row: number;
  col: number;
  neighbors: number[];
  root: boolean;
  forced: boolean;
  selectable: boolean;
  cost: number;
  targetValue: number;
  special: boolean;
  skill?: number;
  bitIndex: number;
}

export interface BoardSolveInput {
  nodes: BoardSolveNode[];
  order: number[];
  stepWork: number[];
  totalWork: number;
  limit: number;
  skillTargets: number[];
}

export class OptimizationMemoryLimit extends Error {}

// The estimates are 16-byte aligned so a signed 32-bit counter can track the full budget.
const sharedBudgetUnit = 16;
function stateSlotBytes(maskWords: number) {
  return Float64Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT * (1 + maskWords);
}
function stateStorageBytes(slots: number, maskWords: number) {
  return 256 + Math.ceil(stateSlotBytes(maskWords) * slots / sharedBudgetUnit) * sharedBudgetUnit;
}
export function boardTableBytes(table: BoardOptimizationTable) {
  let bytes = 0;
  for (const entries of table?.values() ?? []) {
    const slots = entries.scores.length;
    bytes += stateStorageBytes(slots, entries.masks.length / slots);
  }
  return bytes;
}

export interface SharedOptimizationBudget {
  used: Int32Array;
  limit: number;
}

interface StateMemory {
  pool: StateStorage[][];
  maskWords: number;
  bytes: number;
  limit: number;
  bufferedBoards?: (BoardOptimizationTable | undefined)[];
  sharedBudget?: SharedOptimizationBudget;
}

function tryReserveShared({ used, limit }: SharedOptimizationBudget, bytes: number) {
  const units = bytes / sharedBudgetUnit;
  let current = Atomics.load(used, 0);
  const max = limit / sharedBudgetUnit;
  while (current + units <= max) {
    const previous = Atomics.compareExchange(used, 0, current, current + units);
    if (previous === current) return true;
    current = previous;
  }
  return false;
}

function releaseMemory(memory: StateMemory, bytes: number) {
  memory.bytes -= bytes;
  if (memory.sharedBudget) Atomics.sub(memory.sharedBudget.used, 0, bytes / sharedBudgetUnit);
}

function releaseIdlePool(memory: StateMemory) {
  let bytes = 0;
  memory.pool.forEach((bucket, index) => { bytes += bucket.length * stateStorageBytes(2 ** index, memory.maskWords); });
  memory.pool.length = 0;
  if (bytes) releaseMemory(memory, bytes);
}

function reserveMemory(memory: StateMemory, bytes: number) {
  if (memory.sharedBudget) {
    if (!tryReserveShared(memory.sharedBudget, bytes)) {
      releaseIdlePool(memory);
      if (!tryReserveShared(memory.sharedBudget, bytes)) throw new OptimizationMemoryLimit();
    }
    memory.bytes += bytes;
    return;
  }
  if (memory.bytes + bytes > memory.limit) {
    for (let i = memory.pool.length - 1; i >= 0 && memory.bytes + bytes > memory.limit; i--) {
      const bucket = memory.pool[i];
      if (!bucket?.length) continue;
      const blockBytes = stateStorageBytes(2 ** i, memory.maskWords);
      const count = Math.min(bucket.length, Math.ceil((memory.bytes + bytes - memory.limit) / blockBytes));
      bucket.length -= count;
      memory.bytes -= count * blockBytes;
    }
    // Release the boards furthest from consumption only after emptying the pool.
    const boards = memory.bufferedBoards;
    if (boards) for (let i = boards.length - 1; i >= 0 && memory.bytes + bytes > memory.limit; i--) {
      const table = boards[i];
      if (!table) continue;
      boards[i] = undefined;
      memory.bytes -= boardTableBytes(table);
    }
    if (memory.bytes + bytes > memory.limit) throw new OptimizationMemoryLimit();
  }
  memory.bytes += bytes;
}

export interface OptimizationPlan {
  boards: BoardSolveInput[];
  solveBoard(index: number, onProgress?: (progress: BoardProgress) => void): BoardOptimizationTable;
  finish(getBoard: (index: number) => BoardOptimizationTable, bufferedBoards?: (BoardOptimizationTable | undefined)[],
    onFinalizing?: () => void, onMergeProgress?: (progress: MergeProgress) => void): OptimizationResult | null;
}
function takeStateStorage(memory: StateMemory, span: number): StateStorage {
  const bucket = Math.ceil(Math.log2(span));
  const existing = memory.pool[bucket]?.pop();
  if (existing) return existing;
  const size = 2 ** bucket;
  reserveMemory(memory, stateStorageBytes(size, memory.maskWords));
  const buffer = new ArrayBuffer(size * stateSlotBytes(memory.maskWords));
  const scoresBytes = size * Float64Array.BYTES_PER_ELEMENT;
  const specialsBytes = size * Uint32Array.BYTES_PER_ELEMENT;
  return {
    scores: new Float64Array(buffer, 0, size),
    specials: new Uint32Array(buffer, scoresBytes, size),
    masks: new Uint32Array(buffer, scoresBytes + specialsBytes, size * memory.maskWords),
  };
}
function releaseStateStorage(memory: StateMemory, table: StateStorage) {
  const bucket = Math.log2(table.scores.length);
  const available = memory.pool[bucket] ??= [];
  if (available.length >= 4096) {
    releaseMemory(memory, stateStorageBytes(table.scores.length, memory.maskWords));
    return;
  }
  // Clear occupancy so the score and mask arrays can be reused as-is.
  table.specials.fill(0);
  available.push({ scores: table.scores, specials: table.specials, masks: table.masks });
}
function extendStateTable(memory: StateMemory, table: StateTable, firstCost: number, lastCost: number) {
  if (firstCost >= table.offset && lastCost < table.offset + table.scores.length) return;
  const offset = Math.min(firstCost, table.minCost);
  const extent = Math.max(lastCost, table.maxCost);
  const storage = takeStateStorage(memory, Math.max(extent - offset + 1, table.scores.length));
  const from = table.minCost - table.offset, end = table.maxCost - table.offset + 1;
  const to = table.minCost - offset, words = memory.maskWords;
  storage.scores.set(table.scores.subarray(from, end), to);
  storage.specials.set(table.specials.subarray(from, end), to);
  storage.masks.set(table.masks.subarray(from * words, end * words), to * words);
  releaseStateStorage(memory, table);
  Object.assign(table, storage, { offset });
}

interface Step { node: number; previousNeighbors: number[]; keep: number[]; futureGroups: number[]; futureRootMask: number }
interface TransitionScratch { labels: Int32Array; next: Int32Array; components: Int32Array; canonical: Int32Array }
const maxCachedBoundariesPerStep = 1_024;

function skillVariants(nodes: BoardSolveNode[], order: number[], skillTargets: number[]) {
  const counts = skillTargets.map(() => 0);
  let variants = 1;
  return order.map(node => {
    const { skill } = nodes[node];
    if (skill !== undefined && counts[skill] < skillTargets[skill]) {
      variants /= counts[skill] + 1;
      variants *= ++counts[skill] + 1;
    }
    return variants;
  });
}

function chooseTraversal(nodes: BoardSolveNode[], members: number[], skillTargets?: number[]) {
  let order = [...members];
  let bestScore = Infinity;
  const directions = skillTargets
    ? [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [1, 2], [2, -1], [1, -2]]
    : [[1, 0], [0, 1]];
  // This estimate chooses only the traversal order; it never scores or drops solutions.
  for (const [x, y] of directions) for (const major of [1, -1]) for (const minor of [1, -1]) {
    const candidate = [...members].sort((a, b) => {
      const dr = nodes[a].row - nodes[b].row;
      const dc = nodes[a].col - nodes[b].col;
      const secondary = skillTargets ? dr * y - dc * x : x === 1 ? dc : dr;
      return major * (dr * x + dc * y) || minor * secondary;
    });
    const position = new Map(candidate.map((i, rank) => [i, rank]));
    const ends = candidate.map(() => 0);
    const weights = skillTargets ? skillVariants(nodes, candidate, skillTargets) : undefined;
    const closing = candidate.map(() => 0);
    let live = 0, width = 0, peakWidth = 0, score = 0;
    candidate.forEach((i, rank) => {
      live -= ends[rank];
      width -= closing[rank];
      const lastNeighbor = Math.max(-1, ...nodes[i].neighbors.map(j => position.get(j)!));
      if (lastNeighbor > rank) {
        const weight = skillTargets ? Math.log(nodes[i].forced ? 2.4 : 5) : 1;
        live += weight;
        ends[lastNeighbor] += weight;
        width++;
        closing[lastNeighbor]++;
      }
      peakWidth = Math.max(peakWidth, width);
      score += weights ? Math.exp(live) * weights[rank] : 5 ** live;
    });
    if ((!skillTargets || peakWidth <= 30) && score < bestScore) { bestScore = score; order = candidate; }
  }
  return order;
}

function makeSteps(nodes: BoardSolveNode[], order: number[]): Step[] {
  const positions = new Map(order.map((i, position) => [i, position]));
  const last = nodes.map(n => Math.max(-1, ...n.neighbors.map(i => positions.get(i)!)));
  let frontier: number[] = [];
  return order.map((node, position) => {
    const expanded = [...frontier, node];
    const keep = expanded.flatMap((i, index) => last[i] > position ? [index] : []);
    const previousNeighbors = frontier.flatMap((i, index) => nodes[node].neighbors.includes(i) ? [index] : []);
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
        if (nodes[i].root) hasRoot = true;
        frontier.forEach((j, index) => { if (nodes[i].neighbors.includes(j)) mask |= 1 << index; });
        for (const j of nodes[i].neighbors) if (remaining.delete(j)) component.push(j);
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

function estimateBoardWork(nodes: BoardSolveNode[], order: number[], skillTargets: number[]) {
  const positions = new Map(order.map((node, index) => [node, index]));
  const optionalEnds = new Uint32Array(order.length);
  const forcedEnds = new Uint32Array(order.length);
  const variants = skillVariants(nodes, order, skillTargets);
  let optional = 0, forced = 0;
  return order.map((node, index) => {
    optional -= optionalEnds[index];
    forced -= forcedEnds[index];
    const last = Math.max(-1, ...nodes[node].neighbors.map(neighbor => positions.get(neighbor)!));
    if (last > index) {
      if (nodes[node].forced) { forced++; forcedEnds[last]++; }
      else { optional++; optionalEnds[last]++; }
    }
    return 2 ** optional * 1.5 ** forced * variants[index];
  });
}

function selectionChoices({ forced, selectable }: BoardSolveNode) {
  return forced ? [true] : selectable ? [false, true] : [false];
}

function probeTraversal({ nodes, skillTargets, limit }: BoardSolveInput, steps: Step[], scratch: TransitionScratch) {
  const variants = skillVariants(nodes, steps.map(step => step.node), skillTargets);
  let partitions = new Map([['', 0]]);
  let peak = 0, work = 0;
  for (const [index, step] of steps.entries()) {
    const node = nodes[step.node];
    const choices = selectionChoices(node);
    const next = new Map<string, number>();
    for (const [partition, cost] of partitions) for (const selected of choices) {
      const used = cost + (selected ? node.cost : 0);
      if (used > limit) continue;
      const boundary = transition(partition, step, selected, node.root, scratch);
      if (boundary !== null && used < (next.get(boundary) ?? Infinity)) next.set(boundary, used);
      if (next.size > 20_000) return null;
    }
    const estimate = next.size * variants[index];
    peak = Math.max(peak, estimate);
    work += estimate;
    partitions = next;
  }
  return { peak, work };
}

function chooseBoardSteps(board: BoardSolveInput, memoryLimit: number, scratch: TransitionScratch) {
  const { nodes, order, stepWork, skillTargets } = board;
  const existing = makeSteps(nodes, order);
  if (!stepWork.some(states => states * 64 * 1024 >= memoryLimit * 0.65)) return existing;

  const alternativeOrder = chooseTraversal(nodes, order, skillTargets);
  if (alternativeOrder.every((node, index) => node === order[index])) return existing;
  const alternative = makeSteps(nodes, alternativeOrder);
  const next = probeTraversal(board, alternative, scratch);
  if (!next) return existing;
  const current = probeTraversal(board, existing, scratch);
  if (!current) return alternative;
  const lessWork = next.work < current.work * 0.93 && next.peak <= current.peak;
  const lowerPeak = next.peak < current.peak * 0.65 && next.work <= current.work * 1.05;
  if (lessWork || lowerPeak) return alternative;
  return existing;
}

export function createBoardSolver(memoryLimit: number, observe?: (states: number) => void, sharedBudget?: SharedOptimizationBudget) {
  const memory: StateMemory = { pool: [], maskWords: 0, bytes: 0, limit: memoryLimit, sharedBudget };
  const scratch: TransitionScratch = { labels: new Int32Array(32), next: new Int32Array(30),
    components: new Int32Array(32), canonical: new Int32Array(32) };

  function solveBoard(board: BoardSolveInput, onProgress?: (progress: BoardProgress) => void): BoardOptimizationTable {
    const { nodes, order, stepWork, limit, skillTargets } = board;
    const highestBitIndex = nodes.reduce((highest, node) => Math.max(highest, node.bitIndex), 0);
    const words = Math.floor(highestBitIndex / 32) + 1;
    if (words !== memory.maskWords) {
      releaseIdlePool(memory);
      memory.maskWords = words;
    }
    const steps = chooseBoardSteps(board, memoryLimit, scratch);
    const work = onProgress
      ? (steps.every((step, i) => step.node === order[i]) ? stepWork : estimateBoardWork(nodes, steps.map(step => step.node), skillTargets))
      : undefined;
    const totalWork = work === stepWork ? board.totalWork : (work?.reduce((sum, step) => sum + step, 0) ?? 0);
    const skillCount = skillTargets.length;
    const emptyCounts = '0'.repeat(skillCount);
    let completedWork = 0;
    let lastProgressAt = onProgress ? performance.now() : 0;
    onProgress?.({ completedWork, totalWork });
    const initial: StateTable = { ...takeStateStorage(memory, 1), offset: 0, minCost: 0, maxCost: 0 };
    initial.scores[0] = 0;
    initial.specials[0] = 1;
    initial.masks.fill(0, 0, words);
    let states = new Map<string, StateTable>([[emptyCounts, initial]]);
    for (const [stepIndex, step] of steps.entries()) {
      const node = nodes[step.node];
      const { targetValue, special, skill, bitIndex } = node;
      const bitWord = bitIndex < 0 ? -1 : bitIndex >>> 5;
      const bit = 1 << (bitIndex & 31);
      const choices = selectionChoices(node);
      const nextStates = new Map<string, StateTable>();
      // Skill counts and point costs do not affect the connectivity transition.
      // Cache each boundary only for this step and keep its footprint bounded.
      const boundaryCache = skillCount >= 3 && states.size >= 256
        ? new Map<string, (string | null)[]>() : undefined;
      for (const [state, costs] of states) {
        const counts = state.slice(0, skillCount);
        const partition = state.slice(skillCount);
        let boundaries = boundaryCache?.get(partition);
        if (!boundaries && boundaryCache && boundaryCache.size < maxCachedBoundariesPerStep) {
          boundaries = [];
          boundaryCache.set(partition, boundaries);
        }
        for (let choice = 0; choice < choices.length; choice++) {
          const selected = choices[choice];
          const addedCost = selected ? node.cost : 0;
          const firstCost = costs.minCost + addedCost;
          const lastCost = Math.min(costs.maxCost + addedCost, limit);
          if (firstCost > lastCost) continue;
          let boundary = boundaries?.[choice];
          if (boundary === undefined) {
            boundary = transition(partition, step, selected, node.root, scratch);
            if (boundaries) boundaries[choice] = boundary;
          }
          if (boundary === null) continue;
          const nextCounts = selected && skill !== undefined && Number(counts[skill]) < skillTargets[skill]
            ? counts.slice(0, skill) + (Number(counts[skill]) + 1) + counts.slice(skill + 1) : counts;
          const next = nextCounts + boundary;
          let entries = nextStates.get(next);
          if (entries) extendStateTable(memory, entries, firstCost, lastCost);
          else {
            entries = { ...takeStateStorage(memory, lastCost - firstCost + 1),
              offset: firstCost, minCost: firstCost, maxCost: lastCost };
            nextStates.set(next, entries);
          }
          const addedScore = selected ? targetValue : 0;
          const addedSpecial = Number(selected && special);
          for (let nextCost = firstCost; nextCost <= lastCost; nextCost++) {
            const from = nextCost - addedCost - costs.offset;
            const sourceSpecials = costs.specials[from];
            if (sourceSpecials === 0) continue;
            const to = nextCost - entries.offset;
            const score = costs.scores[from] + addedScore;
            const specials = sourceSpecials + addedSpecial;
            const existingScore = entries.scores[to];
            const existingSpecials = entries.specials[to];
            if (existingSpecials !== 0 && (existingScore > score || existingScore === score && existingSpecials < specials)) continue;
            const fromWord = from * words, toWord = to * words;
            if (existingSpecials === specials && existingScore === score) {
              // Compare from the most significant word to preserve the original mask ordering.
              let difference = 0;
              for (let word = words - 1; word >= 0; word--) {
                const candidate = costs.masks[fromWord + word] | (selected && word === bitWord ? bit : 0);
                difference = (candidate >>> 0) - entries.masks[toWord + word];
                if (difference !== 0) break;
              }
              if (difference <= 0) continue;
            }
            entries.scores[to] = score;
            entries.specials[to] = specials;
            for (let word = 0; word < words; word++) entries.masks[toWord + word] = costs.masks[fromWord + word];
            if (selected && bitWord >= 0) entries.masks[toWord + bitWord] |= bit;
            if (nextCost < entries.minCost) entries.minCost = nextCost;
            if (nextCost > entries.maxCost) entries.maxCost = nextCost;
          }
        }
        releaseStateStorage(memory, costs);
      }
      // Same boundary + a cheaper cost + no smaller target score dominates
      // regardless of lower-priority attributes. This is an exact Pareto reduction.
      let stateCount = 0;
      for (const [partition, entries] of nextStates) {
        let bestObjective = -1;
        let firstCost = limit + 1, lastCost = -1;
        for (let cost = entries.minCost; cost <= entries.maxCost; cost++) {
          const index = cost - entries.offset;
          if (entries.specials[index] === 0) continue;
          const score = entries.scores[index];
          if (score <= bestObjective) entries.specials[index] = 0;
          else {
            bestObjective = score;
            if (firstCost > cost) firstCost = cost;
            lastCost = cost;
            if (observe) stateCount++;
          }
        }
        if (lastCost < 0) {
          nextStates.delete(partition);
          releaseStateStorage(memory, entries);
        }
        else { entries.minCost = firstCost; entries.maxCost = lastCost; }
      }
      observe?.(stateCount);
      if (work && onProgress) {
        completedWork += work[stepIndex];
        const now = performance.now();
        if (now - lastProgressAt >= 350) {
          onProgress({ completedWork, totalWork });
          lastProgressAt = now;
        }
      }
      states = nextStates;
      if (!states.size) return null;
    }
    return states;
  }
  return {
    memory, solveBoard,
    prepareTableTransfer(tableBytes: number) {
      if (memory.sharedBudget) releaseIdlePool(memory);
      // Transferred tables stay charged to the parallel budget until merging starts.
      memory.bytes -= tableBytes;
    },
  };
}

export function optimizeGraph(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[], observe?: (states: number) => void): OptimizationResult | null {
  return optimizeWithSkillCounts(graph, budget, required, priority, [], observe);
}

function optimizeWithSkillCounts(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[],
  skills: SkillRequirement[], observe?: (states: number) => void): OptimizationResult | null {
  const plan = createOptimizationPlan(graph, budget, required, priority, skills, { observe });
  return plan && 'solveBoard' in plan ? plan.finish(plan.solveBoard) : plan;
}

interface OptimizationOptions {
  observe?: (states: number) => void;
  memoryLimit?: number;
}

export function createOptimizationPlan(graph: OptimizationGraph, budget: number, required: Set<number>, priority: string[],
  skills: SkillRequirement[], { observe, memoryLimit = Infinity }: OptimizationOptions = {}): OptimizationPlan | OptimizationResult | null {
  const minimumsByBoard = new Map<string, { nodeCosts: number; pathCost: number }>();
  for (const index of required) {
    const { boardKey, cost } = graph.nodes[index];
    const minimum = minimumsByBoard.get(boardKey) ?? { nodeCosts: 0, pathCost: 0 };
    minimum.nodeCosts += cost;
    minimum.pathCost = Math.max(minimum.pathCost, graph.minimumCosts[index]);
    minimumsByBoard.set(boardKey, minimum);
  }
  // Required nodes on the same board can share connecting paths.
  const minimumCost = [...minimumsByBoard.values()].reduce((total, { nodeCosts, pathCost }) => total + Math.max(nodeCosts, pathCost), 0);
  if (minimumCost > budget) return null;
  const targets = new Set(priority);
  const direct = new Set([...graph.roots, ...required]);
  if (budget > 0) for (const [i, { node }] of graph.nodes.entries()) {
    if (node.grade === '일반' && targets.has(node.name)) direct.add(i);
  }
  const directCost = [...direct].reduce((sum, i) => sum + graph.nodes[i].cost, 0);
  const meetsSkills = (selection: Set<number>) => skills.every(skill => skill.nodes.filter(i => selection.has(i)).length >= skill.count);
  if (directCost <= budget && meetsSkills(direct)
    && connectedNodes(graph.nodes, graph.roots, direct).size === direct.size) {
    // Every objective is attained, or the zero budget admits only free roots.
    return { activeKeys: [...direct].map(i => graph.nodes[i].key).sort(), usedPoints: directCost,
      commonCounts: priority.map(name => [...direct].filter(i => graph.nodes[i].node.grade === '일반' && graph.nodes[i].node.name === name).length) };
  }
  const sorted = graph.nodes.map((_, i) => i).sort((a, b) => graph.nodes[a].key < graph.nodes[b].key ? -1 : 1);
  const roots = new Set(graph.roots);
  const optional = (index: number) => !roots.has(index) && !required.has(index);
  const bitIndices = graph.nodes.map(() => -1);
  let nextBit = sorted.filter(optional).length;
  const boardMembers = new Map<string, number[]>();
  sorted.forEach(index => {
    if (optional(index)) bitIndices[index] = --nextBit;
    const { boardKey } = graph.nodes[index];
    const members = boardMembers.get(boardKey);
    if (members) members.push(index);
    else boardMembers.set(boardKey, [index]);
  });
  const membersByBoard = [...boardMembers.values()];
  // Forced bits are identical for every feasible candidate. The remaining bits
  // retain their global key order for tie-breaking, including interleaved boards.
  const contiguousBoards = membersByBoard.flat().every((node, index) => node === sorted[index]);
  const limit = Math.min(budget, graph.nodes.reduce((sum, n) => sum + n.cost, 0));
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
  // Keep a capped count per skill so states with different progress are not
  // compared when pruning by cost and objective.
  const skillTargets = skills.map(skill => skill.count);
  const emptyCounts = '0'.repeat(skillTargets.length);
  const goalCounts = skillTargets.join('');
  const skillByNode = new Map(skills.flatMap((skill, index) => skill.nodes.map(node => [node, index] as const)));
  // Keep the global objective and mask ranks in the board inputs. Workers only
  // need local topology and the already assigned values to reproduce a table.
  const boards = membersByBoard.map((members): BoardSolveInput => {
    const indices = new Map(members.map((node, index) => [node, index]));
    let nextLocalBit = members.filter(optional).length;
    const nodes = members.map((index): BoardSolveNode => {
      const { node, neighbors, cost } = graph.nodes[index];
      const root = roots.has(index);
      const requiredNode = required.has(index);
      const common = node.grade === '일반';
      return {
        row: node.row, col: node.col, neighbors: neighbors.map(neighbor => indices.get(neighbor)!),
        root, forced: root || requiredNode, selectable: graph.minimumCosts[index] <= budget,
        cost, targetValue: common ? placeValues.get(node.name) ?? 0 : 0,
        special: cost > 0 && !common && !requiredNode, skill: skillByNode.get(index),
        bitIndex: contiguousBoards && optional(index) ? --nextLocalBit : bitIndices[index],
      };
    });
    const order = chooseTraversal(nodes, nodes.map((_, index) => index));
    const stepWork = estimateBoardWork(nodes, order, skillTargets);
    return { nodes, order, stepWork, totalWork: stepWork.reduce((sum, work) => sum + work, 0),
      limit: Math.min(limit, nodes.reduce((sum, node) => sum + node.cost, 0)), skillTargets };
  });
  const solver = createBoardSolver(memoryLimit, observe);
  const { memory } = solver;
  const solveBoard = (index: number, onProgress?: (progress: BoardProgress) => void) => solver.solveBoard(boards[index], onProgress);
  const combineBoards = (getBoard: OptimizationPlan['solveBoard'], bufferedBoards: (BoardOptimizationTable | undefined)[],
    onFinalizing?: () => void, onMergeProgress?: (progress: MergeProgress) => void) => {
    // Equal skill counts share one cost frontier. Scores strictly increase with
    // cost after each Pareto reduction.
    let mergeBytes = 0;
    const reserveMerge = (bytes: number) => {
      reserveMemory(memory, bytes);
      mergeBytes += bytes;
    };
    const releaseMerge = (bytes: number) => {
      releaseMemory(memory, bytes);
      mergeBytes -= bytes;
    };
    try {
      const remaining = skills.map(skill => skill.nodes.length);
      const maskBytes = 32 + Math.ceil(graph.nodes.length / 64) * 8;
      let minCost = 0, maxCost = 0, previousBytes = 0;
      let globalEntries = new Map<string, MergeFrontier>([[emptyCounts, {
        costs: Float64Array.of(0), scores: Float64Array.of(0), specials: Uint32Array.of(1), masks: [0n],
      }]]);
      for (const [index, { nodes }] of boards.entries()) {
        for (const { skill } of nodes) {
          if (skill !== undefined) remaining[skill]--;
        }
        let boardEntries = bufferedBoards[index];
        const buffered = boardEntries !== undefined;
        if (buffered) bufferedBoards[index] = undefined;
        else boardEntries = getBoard(index);
        if (!boardEntries || !boardEntries.size) return null;
        // Earlier boards are merged and all later boards are ready to merge.
        if (onFinalizing && boards.every((_, i) => i <= index || bufferedBoards[i] != null)) onFinalizing();

        let localMin = limit, localMax = 0, localBytes = 0;
        const localEntries: [string, MergeFrontier][] = [];
        for (const [counts, entries] of boardEntries) {
          const { offset, scores, specials, masks } = entries;
          const words = masks.length / scores.length;
          const first = entries.minCost - offset, last = entries.maxCost - offset;
          let size = 0;
          for (let slot = first; slot <= last; slot++) size += Number(specials[slot] !== 0);
          const bytes = 384 + size * (60 + Math.ceil(words / 2) * 8);
          reserveMerge(bytes);
          localBytes += bytes;
          const local: MergeFrontier = {
            costs: new Float64Array(size), scores: new Float64Array(size),
            specials: new Uint32Array(size), masks: new Array<bigint>(size),
          };
          let to = 0;
          for (let slot = first; slot <= last; slot++) {
            if (specials[slot] === 0) continue;
            local.costs[to] = offset + slot;
            local.scores[to] = scores[slot];
            local.specials[to] = specials[slot];
            local.masks[to] = readMask(masks, slot, words);
            to++;
          }
          localEntries.push([counts, local]);
          localMin = Math.min(localMin, entries.minCost);
          localMax = Math.max(localMax, entries.maxCost);
        }
        if (!buffered) {
          for (const entries of boardEntries.values()) releaseStateStorage(memory, entries);
        } else {
          releaseMemory(memory, boardTableBytes(boardEntries));
        }
        boardEntries = undefined;

        minCost += localMin;
        maxCost = Math.min(limit, maxCost + localMax);
        if (minCost > maxCost) return null;

        const previousEntries = [...globalEntries];
        const shift = BigInt(contiguousBoards ? nodes.filter(node => node.bitIndex >= 0).length : 0);
        if (shift) for (const [, previous] of previousEntries) {
          for (let i = 0; i < previous.masks.length; i++) previous.masks[i] <<= shift;
        }

        // Work on one output frontier at a time so all groups share one scratch
        // table and only surviving candidates are retained between stages.
        const pairsByCounts = new Map<string, number[]>();
        let pairBytes = 0;
        const lastBoard = index === boards.length - 1;
        let totalWork = 0, completedWork = 0;
        for (const [a, [previousCounts, previous]] of previousEntries.entries()) {
          for (const [b, [localCounts, local]] of localEntries.entries()) {
            if (previous.costs[0] + local.costs[0] > limit) continue;
            let counts = '';
            for (let i = 0; i < skills.length; i++) {
              const count = Math.min(skills[i].count, Number(previousCounts[i]) + Number(localCounts[i]));
              if (count + remaining[i] < skills[i].count) break;
              counts += count;
            }
            if (counts.length !== skills.length) continue;
            let pairs = pairsByCounts.get(counts);
            const bytes = (pairs ? 0 : 128) + 24;
            reserveMerge(bytes);
            pairBytes += bytes;
            if (!pairs) pairsByCounts.set(counts, pairs = []);
            pairs.push(a, b);
            if (onMergeProgress) totalWork += previous.costs.length * (lastBoard ? 1 : local.costs.length);
          }
        }
        let lastProgressAt = onMergeProgress ? performance.now() : 0;
        onMergeProgress?.({ index, completedWork, totalWork });

        const span = maxCost - minCost + 1;
        const scratchBytes = 384 + span * 28;
        reserveMerge(scratchBytes);
        const scores = new Float64Array(span);
        const specials = new Uint32Array(span);
        const prefixMasks = new Array<bigint>(span);
        const localMasks = new Array<bigint>(span);
        const nextEntries = new Map<string, MergeFrontier>();
        let nextBytes = 0;
        for (const [counts, pairs] of pairsByCounts) {
          specials.fill(0);
          for (let pair = 0; pair < pairs.length; pair += 2) {
            const previous = previousEntries[pairs[pair]][1];
            const local = localEntries[pairs[pair + 1]][1];
            let lastLocal = local.costs.length - 1;
            for (let a = 0; a < previous.costs.length; a++) {
              const available = limit - previous.costs[a];
              while (lastLocal >= 0 && local.costs[lastLocal] > available) lastLocal--;
              if (lastLocal < 0) break;
              const prefix = previous.masks[a];
              const prefixScore = previous.scores[a];
              const prefixSpecials = previous.specials[a] - 1;
              const costOffset = previous.costs[a] - minCost;
              // The last board only needs the highest affordable score for each prefix.
              for (let b = lastBoard ? lastLocal : 0; b <= lastLocal; b++) {
                const to = costOffset + local.costs[b];
                const score = prefixScore + local.scores[b];
                const special = prefixSpecials + local.specials[b];
                const existing = specials[to];
                if (existing !== 0) {
                  const existingScore = scores[to];
                  if (existingScore > score || existingScore === score && existing < special) continue;
                  if (existingScore === score && existing === special) {
                    // Disjoint bit ranges preserve the ordering of the concatenated mask.
                    if (contiguousBoards) {
                      const oldPrefix = prefixMasks[to];
                      if (prefix < oldPrefix || prefix === oldPrefix && local.masks[b] <= localMasks[to]) continue;
                    } else if ((prefix | local.masks[b]) <= (prefixMasks[to] | localMasks[to])) continue;
                  }
                }
                scores[to] = score;
                specials[to] = special;
                prefixMasks[to] = prefix;
                localMasks[to] = local.masks[b];
              }
            }
            if (onMergeProgress) {
              completedWork += previous.costs.length * (lastBoard ? 1 : local.costs.length);
              const now = performance.now();
              if (now - lastProgressAt >= 250 && completedWork < totalWork) {
                lastProgressAt = now;
                onMergeProgress({ index, completedWork, totalWork });
              }
            }
          }

          let bestScore = -1, size = 0;
          for (let slot = 0; slot < span; slot++) {
            if (specials[slot] === 0 || scores[slot] <= bestScore) continue;
            bestScore = scores[slot];
            size++;
          }
          const bytes = 384 + size * (28 + maskBytes);
          reserveMerge(bytes);
          nextBytes += bytes;
          const frontier: MergeFrontier = {
            costs: new Float64Array(size), scores: new Float64Array(size),
            specials: new Uint32Array(size), masks: new Array<bigint>(size),
          };
          bestScore = -1;
          let to = 0;
          for (let slot = 0; slot < span; slot++) {
            if (specials[slot] === 0 || scores[slot] <= bestScore) continue;
            bestScore = scores[slot];
            frontier.costs[to] = minCost + slot;
            frontier.scores[to] = bestScore;
            frontier.specials[to] = specials[slot];
            frontier.masks[to] = prefixMasks[slot] | localMasks[slot];
            to++;
          }
          nextEntries.set(counts, frontier);
        }
        globalEntries = nextEntries;
        releaseMerge(previousBytes + pairBytes + localBytes + scratchBytes);
        previousBytes = nextBytes;
        onMergeProgress?.({ index, completedWork, totalWork });
        if (!globalEntries.size) return null;
      }
      const finalists = globalEntries.get(goalCounts);
      if (!finalists) return null;
      const winner = finalists.costs.length - 1;
      const usedPoints = finalists.costs[winner];
      const mask = finalists.masks[winner];
      const selected = new Set([...roots, ...required,
        ...bitIndices.flatMap((bitIndex, i) => bitIndex >= 0 && (mask & (1n << BigInt(bitIndex))) ? [i] : []),
      ]);
      if (!meetsSkills(selected)) throw new Error('Skill requirement mismatch');
      if (verifySelection(graph, selected, budget, required) !== usedPoints) throw new Error('Frontier cost mismatch');
      const commonCounts = priority.map(name => [...selected].filter(i => graph.nodes[i].node.grade === '일반' && graph.nodes[i].node.name === name).length);
      const verifiedObjective = commonCounts.reduce((sum, value, rank) => sum + value * placeValues.get(priority[rank])!, 0);
      if (verifiedObjective !== finalists.scores[winner]) throw new Error('Frontier achievement mismatch');
      return { activeKeys: [...selected].map(i => graph.nodes[i].key).sort(), usedPoints, commonCounts };
    } finally { releaseMerge(mergeBytes); }
  };
  return {
    boards, solveBoard,
    finish(getBoard, bufferedBoards = [], onFinalizing, onMergeProgress) {
      reserveMemory(memory, bufferedBoards.reduce((bytes, table) => bytes + boardTableBytes(table ?? null), 0));
      memory.bufferedBoards = bufferedBoards;
      try { return combineBoards(getBoard, bufferedBoards, onFinalizing, onMergeProgress); }
      finally { memory.bufferedBoards = undefined; }
    },
  };
}
