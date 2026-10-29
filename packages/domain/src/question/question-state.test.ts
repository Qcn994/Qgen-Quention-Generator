import { describe, expect, it } from 'vitest';

import { createQuestion } from './answer-key.ts';
import { canTransition, IllegalTransitionError, transition } from './question-state.ts';
import type { Question } from './question.ts';

export function sampleQuestion(): Question {
  return createQuestion({
    id: 'q1',
    materialId: 'm1',
    type: 'single_choice',
    stem: '下列说法正确的是？',
    options: [
      { id: 'A', text: '行政处罚与行政强制不同', misconceptionId: null },
      { id: 'B', text: '行政处罚就是行政强制', misconceptionId: 'm1' },
    ],
    answer: ['A'],
    primaryKpId: 'kp1',
  });
}

describe('题目状态机', () => {
  it('允许 candidate → verifying，并递增版本号', () => {
    const q = sampleQuestion();
    const next = transition(q, 'verifying');

    expect(next.status).toBe('verifying');
    expect(next.version).toBe(q.version + 1);
    expect(q.status).toBe('candidate');
  });

  it('拒绝 published → verifying（发布后不能回炉重验）', () => {
    const published = transition(
      transition(transition(sampleQuestion(), 'verifying'), 'auto_passed'),
      'published',
    );

    expect(() => transition(published, 'verifying')).toThrow(IllegalTransitionError);
    expect(canTransition('published', 'verifying')).toBe(false);
  });

  it('终态没有任何出边', () => {
    for (const terminal of ['retired', 'rejected'] as const) {
      expect(canTransition(terminal, 'verifying')).toBe(false);
      expect(canTransition(terminal, 'published')).toBe(false);
    }
  });

  it('隔离中的题可以回到 verifying，但不能直接发布', () => {
    expect(canTransition('quarantined', 'verifying')).toBe(true);
    expect(canTransition('quarantined', 'published')).toBe(false);
  });
});
