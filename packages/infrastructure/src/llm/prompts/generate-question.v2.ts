/**
 * 单题生成 prompt（v2）。一次只生成一道题：失败隔离、质量更高、幂等简单（计划第五节）。
 *
 * 选项的错误项必须绑定上面给出的某个 misconception_index；正确答案的 misconception_index 为 null。
 * answer_quote 逐字取自原文，D3 用它反算 [charStart, charEnd)，所以不允许改写。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const GENERATE_QUESTION_PROMPT_VERSION = 'generate-question.v2';

export type PromptQuestionType = 'single_choice' | 'multiple_choice' | 'true_false';

export interface GenerateQuestionPromptInput {
  readonly language: 'zh' | 'en';
  readonly type: PromptQuestionType;
  readonly kpName: string;
  readonly kpSummary: string;
  readonly misconceptions: ReadonlyArray<{
    readonly index: number;
    readonly statement: string;
    readonly correctContrast: string;
  }>;
  readonly sourceText: string;
  readonly targetDifficulty: number;
}

const TYPE_RULES: Record<PromptQuestionType, string> = {
  single_choice: '单选题：4 个选项，恰有 1 个正确。',
  multiple_choice: '多选题：4 个选项，正确项 2–3 个，至少有 1 个错误项。',
  true_false: '判断题：恰好 2 个选项，选项文本固定为「正确」「错误」（英文材料用「True」「False」），恰有 1 个正确。',
};

export function buildGenerateQuestionMessages(input: GenerateQuestionPromptInput): LlmMessage[] {
  const zh = input.language === 'zh';
  const mis = input.misconceptions
    .map(
      (item) =>
        `  [${item.index}] 错误命题：${item.statement}\n      正确对照：${item.correctContrast}`,
    )
    .join('\n');

  const system = `你是资深命题老师。你只输出一个 JSON 对象，不输出任何解释文字。

任务：依据给定原文与考点，出一道${zh ? '中文' : '英文'}题。

硬性规则：
1. ${TYPE_RULES[input.type]}
2. 题目必须**只靠给定原文**就能判定答案，不依赖原文之外的知识。
3. 每个错误选项对应上面给出的一个误区（misconception_index 填该误区编号），正确答案的 misconception_index 为 null。让每个错误选项都"看起来像"那个误区，而不是随便编一个明显错的选项。
4. answer_quote：从原文**逐字复制**一段能直接支持正确答案的连续文字（8–120 字，单句优先），不得改写、不得跨段拼接。系统会用它反算引用坐标，复制不准确本题作废；超过 120 字会被要求重写。
5. explanation：先给结论，再逐项说明为什么对/错；提到误区时用"混淆了…"的表述。指代选项时一律用 A/B/C/D 字母（"选项B"），不要用数字下标（不要写"选项0"）。
6. stem 用疑问句或"以下（哪些）…"句式（v1 出现过陈述句题干）；不得出现"根据上文""如图所示"这类指向不明的话；判断题的题干必须是一个可判定真假的完整陈述。
7. 不要出现"以上都对""以上都不对"；不要用"总是""从不"这类绝对化词制造错误项。
8. difficulty_est 取 1–5 的整数，目标难度约 ${input.targetDifficulty}。
9. 输出语言必须与目标语言一致（${zh ? '中文' : '英文'}）；专有名词可保留原文。

输出格式（严格 JSON）：
{"stem":"...","options":[{"text":"...","misconception_index":0}],"answer_indices":[1],"answer_quote":"...","explanation":"...","difficulty_est":3}`;

  const user = `考点：${input.kpName}
考点摘要：${input.kpSummary}

可用误区（编号只用于 misconception_index）：
${mis.length > 0 ? mis : '  （本考点没有给出误区：错误项请设置 misconception_index 为 null，但仍要设计得合理）'}

原文：
"""
${input.sourceText}
"""`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
