/**
 * 质检结果模型（计划第六节）。
 * hard：任一失败即拒发；soft：加权得分 >= 0.75 才允许发布。
 */

export const HARD_CHECK_TYPES = [
  'schema',
  'citation_exists',
  'citation_supports',
  'answer_unique',
  'blind_solve',
  'answer_contrast',
  'distractor_challenge',
  'duplicate',
  'moderation',
] as const;

export type HardCheckType = (typeof HARD_CHECK_TYPES)[number];

export const SOFT_CHECK_TYPES = [
  'answer_leakage',
  'faithfulness',
  'difficulty_fit',
  'explanation_quality',
] as const;

export type SoftCheckType = (typeof SOFT_CHECK_TYPES)[number];

/** 计划第六节发布门禁的权重：泄漏 .15 / 忠实 .35 / 难度 .15 / 解析质量 .35，合计 1 */
export const SOFT_CHECK_WEIGHTS: Readonly<Record<SoftCheckType, number>> = {
  answer_leakage: 0.15,
  faithfulness: 0.35,
  difficulty_fit: 0.15,
  explanation_quality: 0.35,
};

export interface QuestionCheck {
  readonly type: HardCheckType | SoftCheckType;
  readonly severity: 'hard' | 'soft';
  readonly passed: boolean;
  /** soft 检查的 0–1 得分；hard 检查不适用 */
  readonly score: number | null;
  readonly detail: string | null;
}

export function hardCheck(type: HardCheckType, passed: boolean, detail: string | null = null): QuestionCheck {
  return { type, severity: 'hard', passed, score: null, detail };
}

export function softCheck(type: SoftCheckType, score: number, detail: string | null = null): QuestionCheck {
  const clamped = Math.max(0, Math.min(1, score));
  return { type, severity: 'soft', passed: clamped >= 1, score: clamped, detail };
}
