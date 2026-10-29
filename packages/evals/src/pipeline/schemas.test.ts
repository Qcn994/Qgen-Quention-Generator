import { describe, expect, it } from 'vitest';

import { generatedQuestionSchema, verifyResponseSchema } from './schemas.ts';

const soft = { score: 0.9, detail: 'ok' };

function verifyPayload() {
  return {
    citation_supports: { passed: true, detail: '引用支持答案' },
    distractors: [{ option: 'A', could_be_correct: false, reason: '原文不支持' }],
    soft: {
      answer_leakage: soft,
      faithfulness: soft,
      difficulty_fit: soft,
      explanation_quality: soft,
    },
  };
}

describe('verifyResponseSchema', () => {
  it('4 个 soft check 全部给出时通过', () => {
    expect(verifyResponseSchema.safeParse(verifyPayload()).success).toBe(true);
  });

  it('缺少任一 soft check 即拒绝（禁止缺省，K3 第五轮 Q2）', () => {
    const payload = verifyPayload();
    const { explanation_quality: _dropped, ...rest } = payload.soft;
    const result = verifyResponseSchema.safeParse({ ...payload, soft: rest });

    expect(result.success).toBe(false);
  });

  it('soft 分数越界时拒绝', () => {
    const payload = verifyPayload();
    const result = verifyResponseSchema.safeParse({
      ...payload,
      soft: { ...payload.soft, faithfulness: { score: 1.2, detail: '超界' } },
    });

    expect(result.success).toBe(false);
  });
});

describe('generatedQuestionSchema', () => {
  it('少于 2 个选项时拒绝', () => {
    const result = generatedQuestionSchema.safeParse({
      stem: '题干',
      options: [{ text: '只有一个选项', misconception_index: null }],
      answer_indices: [0],
      answer_quote: '原文引用',
      explanation: '解析',
      difficulty_est: 2,
    });

    expect(result.success).toBe(false);
  });

  it('合法单选题通过', () => {
    const result = generatedQuestionSchema.safeParse({
      stem: '下列说法正确的是？',
      options: [
        { text: 'A 项', misconception_index: null },
        { text: 'B 项', misconception_index: 0 },
        { text: 'C 项', misconception_index: 1 },
        { text: 'D 项', misconception_index: null },
      ],
      answer_indices: [0],
      answer_quote: '原文引用片段',
      explanation: '解析',
      difficulty_est: 3,
    });

    expect(result.success).toBe(true);
  });
});
