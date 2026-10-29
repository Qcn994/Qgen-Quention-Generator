/**
 * 给答案反证 prompt（v1）：难度 4–5 的题不要求盲解全对（会把难题系统性挡在门外），
 * 改为"给出答案，要求从原文推演，并主动寻找第二个可辩护答案"（计划第六节）。
 * 硬条件是**无第二可辩护答案**。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const ANSWER_CONTRAST_PROMPT_VERSION = 'answer-contrast.v1';

export interface AnswerContrastPromptInput {
  readonly language: 'zh' | 'en';
  readonly stem: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly answerLetters: readonly string[];
  readonly sourceText: string;
}

export function buildAnswerContrastMessages(input: AnswerContrastPromptInput): LlmMessage[] {
  const options = input.options.map((option) => `${option.id}. ${option.text}`).join('\n');

  const system = `你是严格的审题员。你只输出一个 JSON 对象。

给定一道题、它声称的正确答案、以及原文依据。你的任务有两步：
1. 从原文出发推导出这个答案（derivation），每一步都必须能指回原文。
2. **主动为其他每一个选项寻找可辩护的理由**——只依据原文，不考虑"出题人显然想考什么"。
   如果某个选项在原文支持下也能成立，则 second_answer_defensible = true 并在 second_answer_reason 说明是哪个选项、依据哪句原文。
   注意：仅仅"有点道理"不算可辩护，必须能在原文里找到直接支持。

输出格式（严格 JSON）：
{"derivation":"...","second_answer_defensible":false,"second_answer_reason":""}`;

  const user = `原文：
"""
${input.sourceText}
"""

题目：${input.stem}

选项：
${options}

声称的正确答案：${input.answerLetters.join(', ')}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
