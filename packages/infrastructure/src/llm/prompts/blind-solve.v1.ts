/**
 * 盲解 prompt（v1）：只给题干、选项与原文，**不给答案**。
 * 两种措辞（直接作答 / 先推理再作答）+ temperature 0.7，让两次采样真正独立（计划第六节）。
 *
 * M0 只有 Qwen 一家厂商，同族相关性使该检查信息量有限——这一点在计划里已明示，
 * 人工复核做全检来兜底；跨厂商质检等密钥到位后启用。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const BLIND_SOLVE_PROMPT_VERSION = 'blind-solve.v1';

export type BlindSolveVariant = 'direct' | 'reason_first';

export interface BlindSolvePromptInput {
  readonly language: 'zh' | 'en';
  readonly stem: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly sourceText: string;
  readonly variant: BlindSolveVariant;
}

export function buildBlindSolveMessages(input: BlindSolvePromptInput): LlmMessage[] {
  const zh = input.language === 'zh';
  const options = input.options.map((option) => `${option.id}. ${option.text}`).join('\n');

  const instruction =
    input.variant === 'direct'
      ? zh
        ? '请直接作答：只输出你选择的选项字母，不要解释。'
        : 'Answer directly: output only the letters of the options you choose, no explanation.'
      : zh
        ? '请先逐步推理（引用原文依据），最后给出你选择的选项字母。'
        : 'Reason step by step first (citing the source), then give the letters of the options you choose.';

  const system = `你是独立解题者。你只能依据给出的原文作答，不使用任何外部知识。你只输出一个 JSON 对象。

${instruction}

输出格式（严格 JSON）：
{"answer_letters":["B"],"reasoning":"..."}
"reasoning" 在直接作答时可以是空字符串。`;

  const user = `原文：
"""
${input.sourceText}
"""

题目：${input.stem}

选项：
${options}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
