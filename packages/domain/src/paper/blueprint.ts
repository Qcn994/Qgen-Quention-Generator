/**
 * 出题蓝图硬规则（计划第五节）：
 *   KP 数 ≈ clamp(页数 / 3, 15, 60)
 *   总题量 ≈ clamp(页数 / 2, 20, 60)
 *   题型配比：中文 50/30/20，英文 60/30/10
 *   importance 4–5 的知识点优先分满
 * 这些都是**规则**，不让模型自由发挥。
 */

import type { QuestionType } from '../question/question.ts';
import type { MaterialLanguage } from '../text/language.ts';

export const KP_MIN = 15;
export const KP_MAX = 60;
export const QUESTION_MIN = 20;
export const QUESTION_MAX = 60;

export const TYPE_MIX: Readonly<Record<MaterialLanguage, Readonly<Record<QuestionType, number>>>> = {
  zh: { single_choice: 0.5, multiple_choice: 0.3, true_false: 0.2 },
  en: { single_choice: 0.6, multiple_choice: 0.3, true_false: 0.1 },
};

function nonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function targetKpCount(pageCount: number): number {
  return clamp(Math.round(nonNegative(pageCount) / 3), KP_MIN, KP_MAX);
}

export function targetQuestionCount(pageCount: number): number {
  return clamp(Math.round(nonNegative(pageCount) / 2), QUESTION_MIN, QUESTION_MAX);
}

/**
 * 最大余数法分配：先取下整，再把余下的名额按小数部分从大到小补上，保证总和 === total。
 */
export function typeDistribution(
  total: number,
  language: MaterialLanguage,
): Record<QuestionType, number> {
  const count = Math.max(0, Math.floor(total));
  const mix = TYPE_MIX[language];
  const types = Object.keys(mix) as QuestionType[];

  const exact = types.map((type) => mix[type] * count);
  const result = types.map((type, index) => ({ type, value: Math.floor(exact[index] ?? 0), remainder: (exact[index] ?? 0) % 1 }));

  let remaining = count - result.reduce((sum, item) => sum + item.value, 0);
  const byRemainder = [...result].sort((a, b) => b.remainder - a.remainder);

  for (const item of byRemainder) {
    if (remaining <= 0) {
      break;
    }
    const target = result.find((entry) => entry.type === item.type);
    if (target) {
      target.value += 1;
      remaining -= 1;
    }
  }

  const distribution = {} as Record<QuestionType, number>;
  for (const item of result) {
    distribution[item.type] = item.value;
  }
  return distribution;
}

export interface AllocationInput {
  readonly importance: number;
}

/**
 * 每个知识点分几题：容量上限为 ceil(总题量 / KP 数)。
 * 按 importance 从高到低**顺序填满**——题量不够时先砍低 importance 的考点（计划第五节），
 * 因此低 importance 的 KP 可能分到 0 题，这是规则本身的结果，不是缺陷。
 */
export function allocateQuestionsPerKp(
  total: number,
  kps: readonly AllocationInput[],
): number[] {
  const count = Math.max(0, Math.floor(total));
  const allocation = kps.map(() => 0);

  if (kps.length === 0 || count === 0) {
    return allocation;
  }

  const capacity = Math.ceil(count / kps.length);
  const order = kps
    .map((kp, index) => ({ index, importance: kp.importance }))
    .sort((a, b) => b.importance - a.importance || a.index - b.index)
    .map((item) => item.index);

  let remaining = count;
  for (const index of order) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(capacity, remaining);
    allocation[index] = take;
    remaining -= take;
  }

  return allocation;
}
