/**
 * 考点抽取 prompt（v1）。发布后不可变：改规则请新建 v2 文件并改调用点，
 * 否则已跑过的 `llm_cache` 会把新旧行为混在一起。
 */

import type { LlmMessage } from '../qwen-client.ts';

export const KP_EXTRACT_PROMPT_VERSION = 'kp-extract.v1';

export interface KpExtractPromptInput {
  readonly language: 'zh' | 'en';
  readonly headingPath: readonly string[];
  readonly text: string;
  readonly maxKps: number;
}

export function buildKpExtractMessages(input: KpExtractPromptInput): LlmMessage[] {
  const system = `你是考试辅导材料的考点抽取器。你只输出一个 JSON 对象，不输出任何解释文字。

任务：从用户给出的一段教材原文中抽取"可以出题"的考点。

硬性规则：
1. 只能抽取原文明确讲到的内容，禁止补充原文之外的知识。
2. 每个考点必须给出 source_quote：从原文**逐字复制**的连续片段（8–120 字），不得改写、不得加省略号、不得跨段拼接。系统会用它在原文里做逐字搜索，找不到就丢弃——所以「……」、『……』之类的拼接一律视为错误。若一个考点分散在多处，只摘录最能支撑它的那一句，不要拼。
3. name ≤ 20 字；summary 用 1–2 句说明"考什么"，不要复述原文。
4. importance 取 1–5 的整数：5 = 高频必考且分值大；1 = 边角料。
5. difficulty 取 1–5 的整数：5 = 需要多步推理或综合多个概念。
6. exam_frequency 取 high / medium / low。
7. 同义或包含关系的考点合并成一个；本段最多 ${input.maxKps} 个；宁可少而准，不要凑数。
8. 输出语言必须与原文语言一致（原文是中文就用中文，是英文就用英文）。

输出格式（严格 JSON）：
{"knowledge_points":[{"name":"...","summary":"...","importance":3,"difficulty":2,"exam_frequency":"medium","source_quote":"..."}]}`;

  const heading = input.headingPath.length > 0 ? input.headingPath.join(' > ') : '（无标题）';
  const user = `标题路径：${heading}

原文：
"""
${input.text}
"""`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
