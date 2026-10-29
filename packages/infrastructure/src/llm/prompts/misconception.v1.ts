/**
 * 易错点辨析 prompt（v1）。
 * 产出直接进入干扰项设计：每个误区都会被某个错误选项绑定，
 * 所以 statement 必须是**学生真的会犯的具体错误命题**，不是"理解不深"这类空话。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const MISCONCEPTION_PROMPT_VERSION = 'misconception.v1';

export interface MisconceptionPromptInput {
  readonly language: 'zh' | 'en';
  readonly kpName: string;
  readonly kpSummary: string;
  readonly sourceText: string;
}

export function buildMisconceptionMessages(input: MisconceptionPromptInput): LlmMessage[] {
  const system = `你是考试辅导老师，专门总结学生在这个考点上最常犯的错误。你只输出一个 JSON 对象。

硬性规则：
1. 每个易错点是一个**具体的错误命题**（学生真的会这么答），不是"理解不深""掌握不牢"这类空话。
   正例："行政处罚可以当场限制人身自由"；反例："对行政处罚理解有偏差"。
2. why_tempting：为什么这个错误看起来有道理（与哪个相邻概念混淆、哪条规则的条件被忽略）。
3. correct_contrast：正确说法，与 statement 形成直接对照，订正页会原样展示。
4. severity 取 low / medium / high：high = 高频且后果严重。
5. evidence 选 1–2 条原文逐字片段（8–120 字），必须是给出的原文中真实出现的连续文字。
6. 最多 3 条，少于 3 条也可以；不要为凑数编造。
7. 输出语言必须与考点语言一致。

输出格式（严格 JSON）：
{"misconceptions":[{"statement":"...","why_tempting":"...","correct_contrast":"...","severity":"high","evidence":["..."]}]}`;

  const user = `考点：${input.kpName}
考点摘要：${input.kpSummary}

原文：
"""
${input.sourceText}
"""`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
