/**
 * LLM 结构化输出的 zod 契约。prompt 里写了什么格式，这里就校验什么——
 * 不一致时宁可让本题失败，也不让半截数据流进质检。
 */

import { z } from 'zod';

export const kpItemSchema = z.object({
  name: z.string().min(1).max(60),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(5),
  difficulty: z.number().int().min(1).max(5),
  exam_frequency: z.enum(['low', 'medium', 'high']),
  source_quote: z.string().min(1),
});

export const kpResponseSchema = z.object({
  knowledge_points: z.array(kpItemSchema).min(1),
});

export const misconceptionItemSchema = z.object({
  statement: z.string().min(1),
  why_tempting: z.string().min(1),
  correct_contrast: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  evidence: z.array(z.string()).max(3),
});

export const misconceptionResponseSchema = z.object({
  misconceptions: z.array(misconceptionItemSchema).max(5),
});

export const generatedOptionSchema = z.object({
  text: z.string().min(1),
  misconception_index: z.number().int().min(0).nullable(),
});

export const generatedQuestionSchema = z.object({
  stem: z.string().min(1),
  options: z.array(generatedOptionSchema).min(2).max(6),
  answer_indices: z.array(z.number().int().min(0)).min(1),
  answer_quote: z.string().min(1),
  explanation: z.string().min(1),
  difficulty_est: z.number().int().min(1).max(5),
});

export const blindSolveSchema = z.object({
  answer_letters: z.array(z.string().min(1)).min(1),
  reasoning: z.string(),
});

export const answerContrastSchema = z.object({
  derivation: z.string(),
  second_answer_defensible: z.boolean(),
  second_answer_reason: z.string(),
});

export const softScoreSchema = z.object({
  score: z.number().min(0).max(1),
  detail: z.string(),
});

/** 4 项 soft check 全部必填——缺省即视为本次质检无效（K3 第五轮 Q2） */
export const verifyResponseSchema = z.object({
  citation_supports: z.object({
    passed: z.boolean(),
    detail: z.string(),
  }),
  distractors: z.array(
    z.object({
      option: z.string(),
      could_be_correct: z.boolean(),
      reason: z.string(),
    }),
  ),
  soft: z.object({
    answer_leakage: softScoreSchema,
    faithfulness: softScoreSchema,
    difficulty_fit: softScoreSchema,
    explanation_quality: softScoreSchema,
  }),
});

export type GeneratedQuestionOutput = z.infer<typeof generatedQuestionSchema>;
export type VerifyResponseOutput = z.infer<typeof verifyResponseSchema>;
export type MisconceptionOutput = z.infer<typeof misconceptionItemSchema>;

/** zod 错误压成一行一行，喂给修复调用，也写进失败记录 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}
