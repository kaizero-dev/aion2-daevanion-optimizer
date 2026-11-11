import type { BoardNode } from './data';
import { gradeOrder } from './grades.ts';
export function summarizeEffects(nodes: BoardNode[]): string[] {
  const numeric = new Map<string, { label: string; suffix: string; value: number; kind: number; grade: number }>();
  const other = new Map<string, { text: string; count: number; kind: number; grade: number }>();
  for (const node of nodes) {
    if (node.type === 'Start') continue;
    const kind = node.type === 'SkillLevel' ? 1 : 0;
    const grade = gradeOrder[node.grade] ?? 4;
    for (const { desc } of node.effectList) {
      if (!desc.trim()) continue;
      const match = desc.trim().match(/^(.*?)\s*([+-]\d+(?:\.\d+)?)(%?)$/);
      if (!match) {
        const key = `${kind}\u0000${desc}`;
        const entry = other.get(key) ?? { text: desc, count: 0, kind, grade };
        entry.count++; entry.grade = Math.min(entry.grade, grade); other.set(key, entry);
        continue;
      }
      const [, label, amount, suffix] = match;
      const key = `${kind}\u0000${label.trim()}\u0000${suffix}`;
      const entry = numeric.get(key) ?? { label: label.trim(), suffix, value: 0, kind, grade };
      entry.value += Number(amount);
      entry.grade = Math.min(entry.grade, grade);
      numeric.set(key, entry);
    }
  }
  return [...[...numeric.values()].map(({ label, suffix, value, kind, grade }) => ({ kind, grade,
    text: `${label} ${value >= 0 ? '+' : ''}${Number(value.toFixed(6))}${suffix}` })),
    ...[...other.values()].map(({ text, count, kind, grade }) => ({ kind, grade, text: count > 1 ? `${text} ×${count}` : text }))]
    .sort((a, b) => a.kind - b.kind || a.grade - b.grade || a.text.localeCompare(b.text, 'ko')).map(entry => entry.text);
}
