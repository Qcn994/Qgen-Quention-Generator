/**
 * 质检 prompt（v1）：一次调用出具 citation_supports、distractor_challenge 与 4 个 soft check。
 *
 * 契约（K3 第五轮 Q2）：4 个 soft check **必须全部出具**，不适用也要用分数表达，禁止缺省——
 * 发布门禁的分母固定为全部 soft 权重，缺省就等于"没跑 = 没通过"，所以这里不允许漏字段。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const VERIFY_QUESTION_PROMPT_VERSION = 'verify-question.v1';

export interface VerifyQuestionPromptInput {
  readonly language: 'zh' | 'en';
  readonly stem: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly answerLetters: readonly string[];
  readonly explanation: string;
  readonly answerQuote: string;
  readonly sourceText: string;
  readonly difficultyEst: number;
}

export function buildVerifyQuestionMessages(input: VerifyQuestionPromptInput): LlmMessage[] {
  const options = input.options.map((option) => `${option.id}. ${option.text}`).join('\n');

  const system = `你是题目质检员。你只输出一个 JSON 对象，不输出任何解释文字。

先理解事实，再逐项打分。所有判断都**只依据给出的原文**。

一、citation_supports：给出的「答案依据引用」是否直接支持声称的正确答案。
   passed = true 仅当引用本身足以推出答案；引用只是相关但不足以推出，判 false。

二、distractors：对**每一个错误选项**判断"根据原文它是否可能也成立"。
   could_be_correct = true 表示这个干扰项其实站得住脚（这是严重问题）。
   正确答案不出现在 distractors 列表里。

三、soft 四项打分（0–1 的数值，必须全部给出）：
   - answer_leakage：选项长度是否明显失衡、正确答案是否因措辞/语法不匹配而泄露、是否出现绝对化词。
     1 = 完全无泄漏；0 = 一眼能猜出答案。
   - faithfulness：解析中的每个论断是否都能被原文/引用支持。1 = 全部有据；0 = 关键论断无据或与原文矛盾。
   - difficulty_fit：题目实际难度与声称难度 ${input.difficultyEst} 是否匹配（1–5）。1 = 完全匹配；0 = 严重不符。
   - explanation_quality：解析是否逐项说明了为什么对/错、是否点出了混淆点、是否可独立读懂。1 = 优秀；0 = 只有结论。
   打分要严格：0.7 以下意味着"有明显问题"。不适用时也用分数表达（例如没有误区，则 explanation_quality 按是否逐项说明判分），禁止省略字段。

输出格式（严格 JSON）：
{"citation_supports":{"passed":true,"detail":"..."},
 "distractors":[{"option":"A","could_be_correct":false,"reason":"..."}],
 "soft":{"answer_leakage":{"score":0.9,"detail":"..."},
         "faithfulness":{"score":0.9,"detail":"..."},
         "difficulty_fit":{"score":0.8,"detail":"..."},
         "explanation_quality":{"score":0.85,"detail":"..."}}}`;

  const user = `原文：
"""
${input.sourceText}
"""

题目：${input.stem}

选项：
${options}

声称的正确答案：${input.answerLetters.join(', ')}

解析：${input.explanation}

答案依据引用：「${input.answerQuote}」`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
