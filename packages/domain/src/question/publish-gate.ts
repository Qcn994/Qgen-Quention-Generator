/**
 * 发布门禁（计划第六节）：
 *   canPublish = 可适用的 hard check 全部存在且通过
 *                && softScore >= 0.75
 *                && 至少一条 answer_basis 引用
 *
 * fail-closed：
 *   - 缺失的 soft 检查按 0 分计入分母——校验器没跑过，就是没通过；
 *   - 缺失的**可适用** hard check 等同未通过——校验器静默漏跑不能变成"没跑 = 通过"
 *     （K3 第五轮 Major 2）。适用集合由校验器按难度分层算好传入，domain 不建模难度规则。
 */

import {
  HARD_CHECK_TYPES,
  SOFT_CHECK_WEIGHTS,
  type HardCheckType,
  type QuestionCheck,
  type SoftCheckType,
} from './checks.ts';
import type { Question } from './question.ts';

export const PUBLISH_SOFT_SCORE_MIN = 0.75;

export type PublishBlockReason =
  | 'hard_check_failed'
  | 'hard_check_missing'
  | 'soft_score_too_low'
  | 'missing_answer_basis'
  /** 校验器侧的 M0 策略：难度 4–5 在跨厂商质检到位前一律转人工（K3 D3 Major 1）。 */
  | 'high_difficulty_manual_review';

export interface PublishDecision {
  readonly canPublish: boolean;
  readonly softScore: number;
  readonly reasons: readonly PublishBlockReason[];
}

export function softScoreOf(checks: readonly QuestionCheck[]): number {
  let score = 0;

  for (const check of checks) {
    if (check.severity !== 'soft') {
      continue;
    }
    const weight = SOFT_CHECK_WEIGHTS[check.type as SoftCheckType];
    if (weight === undefined) {
      continue;
    }
    score += (check.score ?? (check.passed ? 1 : 0)) * weight;
  }

  // 分母固定为全部 soft 检查权重之和（= 1），未运行的检查按 0 计
  return Math.max(0, Math.min(1, score));
}

/**
 * @param applicableHardChecks 本题应当运行的 hard 检查。缺省为全部 9 种（最严）；
 *   D3 校验器按难度分层（≤3 要求盲解、4–5 要求答案推导）计算后传入。
 */
export function evaluatePublish(
  question: Question,
  checks: readonly QuestionCheck[],
  applicableHardChecks: readonly HardCheckType[] = HARD_CHECK_TYPES,
): PublishDecision {
  const reasons: PublishBlockReason[] = [];
  const presentHard = new Set(
    checks.filter((check) => check.severity === 'hard').map((check) => check.type),
  );

  if (checks.some((check) => check.severity === 'hard' && !check.passed)) {
    reasons.push('hard_check_failed');
  }

  if (applicableHardChecks.some((type) => !presentHard.has(type))) {
    reasons.push('hard_check_missing');
  }

  const softScore = softScoreOf(checks);
  if (softScore < PUBLISH_SOFT_SCORE_MIN) {
    reasons.push('soft_score_too_low');
  }

  if (!question.sourceRefs.some((ref) => ref.role === 'answer_basis')) {
    reasons.push('missing_answer_basis');
  }

  return { canPublish: reasons.length === 0, softScore, reasons };
}
