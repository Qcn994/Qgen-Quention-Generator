import { describe, expect, it } from 'vitest';

import {
  checkAnswerKey,
  createQuestion,
  InvalidAnswerKeyError,
} from './answer-key.ts';
import type { QuestionOption } from './question.ts';

const options = (ids: readonly string[]): QuestionOption[] =>
  ids.map((id) => ({ id, text: `选项 ${id}`, misconceptionId: null }));

const base = {
  id: 'q1',
  materialId: 'm1',
  stem: '题干',
  primaryKpId: 'kp1',
} as const;

describe('答案键校验', () => {
  it('接受合法的单选 / 多选 / 判断', () => {
    expect(
      checkAnswerKey({ type: 'single_choice', options: options(['A', 'B']), answer: ['A'] }),
    ).toEqual([]);

    expect(
      checkAnswerKey({
        type: 'multiple_choice',
        options: options(['A', 'B', 'C', 'D']),
        answer: ['A', 'C'],
      }),
    ).toEqual([]);

    expect(
      checkAnswerKey({ type: 'true_false', options: options(['T', 'F']), answer: ['T'] }),
    ).toEqual([]);
  });

  it('单选有 2 个答案时拒绝构造', () => {
    expect(() =>
      createQuestion({
        ...base,
        type: 'single_choice',
        options: options(['A', 'B', 'C']),
        answer: ['A', 'B'],
      }),
    ).toThrow(InvalidAnswerKeyError);
  });

  it('多选只有 1 个答案时拒绝构造', () => {
    expect(() =>
      createQuestion({
        ...base,
        type: 'multiple_choice',
        options: options(['A', 'B', 'C']),
        answer: ['A'],
      }),
    ).toThrow(InvalidAnswerKeyError);
  });

  it('答案指向不存在的选项时拒绝构造', () => {
    expect(() =>
      createQuestion({
        ...base,
        type: 'single_choice',
        options: options(['A', 'B']),
        answer: ['Z'],
      }),
    ).toThrow(InvalidAnswerKeyError);
  });

  it('没有干扰项（所有选项都是答案）时拒绝构造', () => {
    expect(() =>
      createQuestion({
        ...base,
        type: 'multiple_choice',
        options: options(['A', 'B']),
        answer: ['A', 'B'],
      }),
    ).toThrow(InvalidAnswerKeyError);
  });

  it('判断题必须恰好两个选项', () => {
    expect(() =>
      createQuestion({
        ...base,
        type: 'true_false',
        options: options(['T', 'F', 'U']),
        answer: ['T'],
      }),
    ).toThrow(InvalidAnswerKeyError);
  });

  it('重复的选项 id 被拒绝', () => {
    const problems = checkAnswerKey({
      type: 'single_choice',
      options: [
        { id: 'A', text: '一', misconceptionId: null },
        { id: 'A', text: '二', misconceptionId: null },
      ],
      answer: ['A'],
    });

    expect(problems.map((p) => p.code)).toContain('duplicate_option_id');
  });
});
