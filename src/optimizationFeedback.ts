import manifest from '../data/manifest.json';

export interface OptimizationSettings {
  classKey: string;
  availablePoints: number;
  requiredNodeNames: string[];
  commonNodePriority: string[];
}

export type OptimizationFailure = 'insufficient-points' | 'unreachable-required' | 'optimization-failed';

const messages: Record<OptimizationFailure, string> = {
  'insufficient-points': '데바니온 포인트가 부족합니다.',
  'unreachable-required': '불가능한 노드 설정입니다.',
  'optimization-failed': '최적화가 어렵습니다. 개발자에게 문의하세요.',
};

// Call with the failed request's snapshot, never the current editable UI state.
// The worker integration will call this only for a terminal failure, not while running or cancelling.
export function reportOptimizationFailure(kind: OptimizationFailure, settings: OptimizationSettings) {
  const createdAt = new Date().toISOString();
  const json = kind === 'optimization-failed' ? JSON.stringify({
    schemaVersion: 1,
    createdAt,
    dataVersion: manifest.version,
    dataPatchDate: '2026-11-11',
    failure: kind,
    settings,
  }, null, 2) : null;

  window.alert(messages[kind]);
  if (json === null) return;

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `daevanion-settings-${createdAt.replace(/[:.]/g, '-')}.json`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
