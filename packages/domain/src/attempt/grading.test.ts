import { describe, expect, it } from 'vitest';

import { gradeObjective } from './grading.ts';

const multi = { answer: ['A', 'C'] as const };
const single = { answer: ['B'] as const };

describe('客观题判分', () => {
  it('单选：精确匹配', () => {
    expect(gradeObjective(single, ['B']).correct).toBe(true);
    expect(gradeObjective(single, ['A']).correct).toBe(false);
    expect(gradeObjective(single, []).correct).toBe(false);
  });

  it('多选：全对才得分', () => {
    expect(gradeObjective(multi, ['A', 'C'])).toMatchObject({ correct: true, score: 1 });
    // 顺序无关
    expect(gradeObjective(multi, ['C', 'A']).correct).toBe(true);
    // 漏选
    expect(gradeObjective(multi, ['A'])).toMatchObject({ correct: false, score: 0 });
    // 错选
    expect(gradeObjective(multi, ['A', 'C', 'D'])).toMatchObject({
      correct: false,
      missing: [],
      wrong: ['D'],
    });
    // 全选
    expect(gradeObjective(multi, ['A', 'B', 'C', 'D']).correct).toBe(false);
  });

  it('给出缺失项与错选项，供订正页使用', () => {
    const result = gradeObjective(multi, ['A', 'B']);
    expect(result.missing).toEqual(['C']);
    expect(result.wrong).toEqual(['B']);
  });

  it('重复作答不会改变结果', () => {
    expect(gradeObjective(multi, ['A', 'C', 'C']).correct).toBe(true);
  });
});
