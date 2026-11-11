import type { BoardNode } from './data';
export function summarizeEffects(nodes: BoardNode[]): string[] {
  const numeric = new Map<string, { label: string; suffix: string; value: number }>();
  const other = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === 'Start') continue;
    for (const { desc } of node.effectList) {
      if (!desc.trim()) continue;
      const match = desc.trim().match(/^(.*?)\s*([+-]\d+(?:\.\d+)?)(%?)$/);
      if (!match) { other.set(desc, (other.get(desc) ?? 0) + 1); continue; }
      const [, label, amount, suffix] = match;
      const key = `${label.trim()}\u0000${suffix}`;
      const entry = numeric.get(key) ?? { label: label.trim(), suffix, value: 0 };
      entry.value += Number(amount);
      numeric.set(key, entry);
    }
  }
  return [...[...numeric.values()].map(({ label, suffix, value }) => `${label} ${value >= 0 ? '+' : ''}${Number(value.toFixed(6))}${suffix}`),
    ...[...other].map(([desc, count]) => count > 1 ? `${desc} ×${count}` : desc)].sort((a, b) => a.localeCompare(b, 'ko'));
}
