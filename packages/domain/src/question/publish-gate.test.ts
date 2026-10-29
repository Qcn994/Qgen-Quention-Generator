import { describe, expect, it } from 'vitest';

import { createQuestion } from './answer-key.ts';
import {
  HARD_CHECK_TYPES,
  hardCheck,
  softCheck,
  type HardCheckType,
  type QuestionCheck,
} from './checks.ts';
import type { Question, SourceRole } from './question.ts';
import { evaluatePublish, PUBLISH_SOFT_SCORE_MIN, softScoreOf } from './publish-gate.ts';

function questionWithRole(role: SourceRole | null): Question {
  return createQuestion({
    id: 'q1',
    materialId: 'm1',
    type: 'single_choice',
    stem: '下列说法正确的是？',
    options: [
      { id: 'A', text: '正确项', misconceptionId: null },
      { id: 'B', text: '干扰项', misconceptionId: 'mc1' },
    ],
    answer: ['A'],
    primaryKpId: 'kp1',
    sourceRefs:
      role === null
        ? []
        : [{ chunkId: 'c1', quote: '原文', charStart: 0, charEnd: 2, pageNo: 1, role }],
  });
}

/** 全部 9 种 hard check 默认通过；需要制造失败时按类型覆盖 */
function allHardPass(overrides: Partial<Record<HardCheckType, boolean>> = {}): QuestionCheck[] {
  return HARD_CHECK_TYPES.map((type) => hardCheck(type, overrides[type] ?? true));
}

const ALL_SOFT_PERFECT: QuestionCheck[] = [
  softCheck('answer_leakage', 1),
  softCheck('faithfulness', 1),
  softCheck('difficulty_fit', 1),
  softCheck('explanation_quality', 1),
];

describe('发布门禁', () => {
  it('可适用的 hard 全部通过 + soft 满分 + 有 answer_basis → 可发布', () => {
    const decision = evaluatePublish(questionWithRole('answer_basis'), [
      ...allHardPass(),
      ...ALL_SOFT_PERFECT,
    ]);
    expect(decision.canPublish).toBe(true);
    expect(decision.softScore).toBe(1);
    expect(decision.reasons).toEqual([]);
  });

  it('任一 hard check 失败即拒发', () => {
    const decision = evaluatePublish(questionWithRole('answer_basis'), [
      ...allHardPass({ duplicate: false }),
      ...ALL_SOFT_PERFECT,
    ]);
    expect(decision.canPublish).toBe(false);
    expect(decision.reasons).toContain('hard_check_failed');
  });

  it('fail-closed：可适用但缺失的 hard check 等同未通过', () => {
    const checks = allHardPass().filter((check) => check.type !== 'moderation');
    const decision = evaluatePublish(questionWithRole('answer_basis'), [
      ...checks,
      ...ALL_SOFT_PERFECT,
    ]);
    expect(decision.canPublish).toBe(false);
    expect(decision.reasons).toContain('hard_check_missing');
  });

  it('显式传入的适用集合之外不要求 hard check', () => {
    // 难度 ≤3 的题不要求 answer_contrast：校验器算出适用集合后传入，缺它不影响发布
    const applicable = HARD_CHECK_TYPES.filter((type) => type !== 'answer_contrast');
    const checks = allHardPass().filter((check) => check.type !== 'answer_contrast');
    const decision = evaluatePublish(
      questionWithRole('answer_basis'),
      [...checks, ...ALL_SOFT_PERFECT],
      applicable,
    );
    expect(decision.canPublish).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('soft 加权得分低于 0.75 拒发', () => {
    const checks = [
      ...allHardPass(),
      softCheck('answer_leakage', 1),
      softCheck('faithfulness', 1),
      softCheck('difficulty_fit', 1),
      softCheck('explanation_quality', 0),
    ];
    const decision = evaluatePublish(questionWithRole('answer_basis'), checks);
    expect(decision.softScore).toBeCloseTo(0.65, 10);
    expect(decision.softScore).toBeLessThan(PUBLISH_SOFT_SCORE_MIN);
    expect(decision.canPublish).toBe(false);
    expect(decision.reasons).toContain('soft_score_too_low');
  });

  it('没有 answer_basis 引用拒发（即使其它全过）', () => {
    const decision = evaluatePublish(questionWithRole(null), [
      ...allHardPass(),
      ...ALL_SOFT_PERFECT,
    ]);
    expect(decision.canPublish).toBe(false);
    expect(decision.reasons).toContain('missing_answer_basis');
  });

  it('只有 context 引用不算 answer_basis', () => {
    const decision = evaluatePublish(questionWithRole('context'), [
      ...allHardPass(),
      ...ALL_SOFT_PERFECT,
    ]);
    expect(decision.canPublish).toBe(false);
  });

  it('fail-closed：未运行的 soft 检查按 0 计入分母', () => {
    expect(softScoreOf([softCheck('answer_leakage', 1)])).toBeCloseTo(0.15, 10);
    expect(softScoreOf([])).toBe(0);
    expect(softScoreOf([hardCheck('schema', true)])).toBe(0);
  });

  it('soft 得分被夹在 [0, 1]', () => {
    expect(softScoreOf([softCheck('faithfulness', 5)])).toBeCloseTo(0.35, 10);
    expect(softScoreOf([softCheck('faithfulness', -1)])).toBe(0);
  });
});
