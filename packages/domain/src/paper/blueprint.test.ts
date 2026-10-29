import { describe, expect, it } from 'vitest';

import {
  allocateQuestionsPerKp,
  KP_MAX,
  KP_MIN,
  QUESTION_MAX,
  QUESTION_MIN,
  targetKpCount,
  targetQuestionCount,
  typeDistribution,
} from './blueprint.ts';

describe('题量与考点粒度公式', () => {
  it('KP 数 = clamp(页数/3, 15, 60)', () => {
    expect(targetKpCount(0)).toBe(KP_MIN);
    expect(targetKpCount(45)).toBe(15);
    expect(targetKpCount(100)).toBe(33);
    expect(targetKpCount(180)).toBe(60);
    expect(targetKpCount(500)).toBe(KP_MAX);
  });

  it('总题量 = clamp(页数/2, 20, 60)', () => {
    expect(targetQuestionCount(0)).toBe(QUESTION_MIN);
    expect(targetQuestionCount(40)).toBe(20);
    expect(targetQuestionCount(100)).toBe(50);
    expect(targetQuestionCount(300)).toBe(60);
    expect(targetQuestionCount(500)).toBe(QUESTION_MAX);
  });

  it('非法页数不会炸：负数与 NaN 按 0 处理', () => {
    expect(targetKpCount(-10)).toBe(KP_MIN);
    expect(targetQuestionCount(Number.NaN)).toBe(QUESTION_MIN);
  });
});

describe('题型配比', () => {
  it('中文 50/30/20', () => {
    expect(typeDistribution(100, 'zh')).toEqual({
      single_choice: 50,
      multiple_choice: 30,
      true_false: 20,
    });
  });

  it('英文 60/30/10', () => {
    expect(typeDistribution(100, 'en')).toEqual({
      single_choice: 60,
      multiple_choice: 30,
      true_false: 10,
    });
  });

  it('小样本按最大余数法分配，总和恒等于题量', () => {
    expect(typeDistribution(10, 'zh')).toEqual({
      single_choice: 5,
      multiple_choice: 3,
      true_false: 2,
    });

    // 7 × (0.6, 0.3, 0.1) = (4.2, 2.1, 0.7) → 取整 4/2/0，余 1 给小数部分最大的判断题
    expect(typeDistribution(7, 'en')).toEqual({
      single_choice: 4,
      multiple_choice: 2,
      true_false: 1,
    });

    for (const total of [20, 21, 37, 50, 60]) {
      for (const language of ['zh', 'en'] as const) {
        const distribution = typeDistribution(total, language);
        const sum = Object.values(distribution).reduce((acc, value) => acc + value, 0);
        expect(sum).toBe(total);
      }
    }
  });
});

describe('每题量到知识点的分配', () => {
  it('总量守恒，且不超过容量上限 ceil(总题量 / KP 数)', () => {
    const kps = Array.from({ length: 33 }, (_, index) => ({ importance: (index % 5) + 1 }));
    const allocation = allocateQuestionsPerKp(50, kps);

    expect(allocation.reduce((sum, value) => sum + value, 0)).toBe(50);
    expect(Math.max(...allocation)).toBeLessThanOrEqual(Math.ceil(50 / 33));
  });

  it('importance 高者优先分满；题量不够时低 importance 的考点先被砍到 0', () => {
    const kps = [{ importance: 1 }, { importance: 5 }, { importance: 5 }, { importance: 3 }];
    const allocation = allocateQuestionsPerKp(5, kps);

    expect(allocation.reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(allocation[1]).toBe(2); // importance 5 → 先分满
    expect(allocation[2]).toBe(2);
    expect(allocation[3]).toBe(1); // importance 3 → 拿剩余
    expect(allocation[0]).toBe(0); // importance 1 → 被砍
  });

  it('空知识点列表或无题量时返回全 0，不抛错', () => {
    expect(allocateQuestionsPerKp(10, [])).toEqual([]);
    expect(allocateQuestionsPerKp(0, [{ importance: 5 }])).toEqual([0]);
  });
});
