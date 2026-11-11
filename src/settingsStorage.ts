import { classes, costs, getBoards } from './data';
import { buildGraph, prepareInput } from './optimizationGraph';
export const defaultPriority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
export interface StoredSettings { classKey: string; points: string; required: string[]; priority: string[] }
const storageKey = 'daevanion-settings-v1';
export function defaultRequiredNames(classKey: string): string[] {
  return [...new Set(getBoards(classKey).flatMap(board => board.nodeList.filter(node => ['유일', '전승', '희귀'].includes(node.grade)).map(node => node.name)))];
}
export function readSettings(): StoredSettings {
  const fallback = { classKey: 'gladiator', points: '837', required: defaultRequiredNames('gladiator'), priority: [...defaultPriority] };
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as StoredSettings | null;
    if (!value || typeof value.points !== 'string' || (value.points !== '' && !/^\d+$/.test(value.points)) || !classes.some(c => c.key === value.classKey)) return fallback;
    const graph = buildGraph(getBoards(value.classKey), costs);
    // Validate shape and current data membership without rejecting stored low budgets.
    const prepared = prepareInput(graph, { classKey: value.classKey, availablePoints: Number.MAX_SAFE_INTEGER,
      requiredNodeNames: value.required, commonNodePriority: value.priority }, classes.map(c => c.key));
    if (!prepared.ok || !Number.isSafeInteger(Number(value.points))) return fallback;
    return { ...value, required: [...value.required], priority: [...value.priority] };
  } catch { return fallback; }
}
export function saveSettings(settings: StoredSettings) {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Storage may be disabled or full. */ }
}
