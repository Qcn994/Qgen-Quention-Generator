/**
 * 给答案反证 prompt（v2）：难度 4–5 的题不要求盲解全对（会把难题系统性挡在门外），
 * 改为"给出答案，要求从原文推演，并主动寻找第二个可辩护答案"（计划第六节）。
 * 硬条件是**无第二可辩护答案**。
 *
 * v2（K3 D3 Major 1②）：v1 实测出现"推理文本写 false、结构化字段输出 true"的自相矛盾。
 * 本轮加自洽要求：先写 derivation，再下结论；字段必须与 derivation 一致。
 * 注意：v2 只是缓解，根因是同厂商自证；难度 4–5 已一律转人工。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const ANSWER_CONTRAST_PROMPT_VERSION = 'answer-contrast.v2';

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

给定一道题、它声称的正确答案、以及原文依据。你的任务分三步，必须按顺序完成：
1. 从原文出发推导出这个答案（derivation），每一步都必须能指回原文。
2. **主动为其他每一个选项寻找可辩护的理由**——只依据原文，不考虑"出题人显然想考什么"。
   如果某个选项在原文支持下也能成立，则判定"存在第二可辩护答案"。
   注意：仅仅"有点道理"不算可辩护，必须能在原文里找到直接支持。
3. 根据第 2 步的结论填写字段：
   - 若没有任何其他选项能只靠原文成立 → second_answer_defensible = false，second_answer_reason = ""；
   - 若有至少一个选项能只靠原文成立 → second_answer_defensible = true，并在 second_answer_reason 说明是哪个选项、依据哪句原文。

自洽要求（v1 实测违反过）：second_answer_defensible 必须与 derivation 的最终结论一致。
如果 derivation 里写了"没有第二个可辩护答案"，该字段只能是 false；反之亦然。
输出前请回读 derivation 的最后一句与字段取值，确认二者不矛盾。

输出格式（严格 JSON，字段顺序固定）：
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
