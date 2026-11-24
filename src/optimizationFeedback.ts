export interface OptimizationSettings {
  classKey: string;
  availablePoints: number;
  requiredNodeNames: string[];
  requiredSkillCounts?: Record<string, number>;
  commonNodePriority: string[];
}

export type OptimizationFailure = 'insufficient-points' | 'unreachable-required' | 'optimization-failed' | 'resource-limit';

const messages: Record<OptimizationFailure, string> = {
  'insufficient-points': '데바니온 포인트가 부족합니다.',
  'unreachable-required': '불가능한 노드 설정입니다.',
  'optimization-failed': '최적화에 실패했습니다. 다시 시도해주세요.',
  'resource-limit': '계산량이 너무 많습니다. 스킬 Lv1~3 지정을 줄여주세요.',
};

export function reportOptimizationFailure(kind: OptimizationFailure) {
  window.alert(messages[kind]);
}
