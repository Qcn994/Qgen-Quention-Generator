/**
 * Spike 报告：人工复核表 + 门槛记分卡。
 *
 * 原则：需要人下结论的指标一律标「待人工」，绝不把自动指标冒充人工结论；
 * 硬错误率在人工填完表之前就是 null（计划第十一节）。
 */

import type { SpikeResult, SpikeStats } from './spike.ts';

export function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ');
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

const TYPE_LABEL: Record<string, string> = {
  single_choice: '单选',
  multiple_choice: '多选',
  true_false: '判断',
};

function statusLabel(result: SpikeResult, index: number): string {
  const record = result.questions[index];
  if (!record) {
    return '-';
  }
  if (record.decision.canPublish) {
    return '自动可发布';
  }
  return `待人工复核（${record.decision.reasons.join(', ')}）`;
}

export function buildQuestionReviewTable(result: SpikeResult): string {
  // 「首尾行疑似误删」列来自 K3 D3 复审 Minor 2：页眉剥离是启发式，
  // 人审顺手确认引用所在块的首尾行没有被误删，比再写一套版式识别便宜。
  const header =
    '| # | 题型 | 难度 | 知识点 | 题干（截断） | 答案 | 答案依据（页码） | soft | 自动结论 | 人工可用 | 硬错误分类 | 首尾行疑似误删 | 备注 |';
  const divider = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';

  const rows = result.questions.map((record, index) => {
    const question = record.question;
    const quote = question.sourceRefs[0];
    const quoteCell = quote ? `「${truncate(quote.quote, 40)}」p.${quote.pageNo}` : '（无）';
    return [
      String(index + 1),
      TYPE_LABEL[question.type] ?? question.type,
      String(question.difficultyEst),
      escapeCell(record.kpName),
      escapeCell(truncate(question.stem, 60)),
      question.answer.join(''),
      escapeCell(quoteCell),
      record.decision.softScore.toFixed(2),
      escapeCell(statusLabel(result, index)),
      '',
      '',
      '',
      '',
    ].join(' | ');
  });

  return [header, divider, ...rows.map((row) => `| ${row} |`)].join('\n');
}

interface MetricRow {
  readonly name: string;
  readonly threshold: string;
  readonly value: string;
  readonly verdict: string;
}

function ratio(numerator: number, denominator: number): string {
  return denominator === 0 ? '0/0' : `${numerator}/${denominator}`;
}

function buildMetricRows(stats: SpikeStats): MetricRow[] {
  // 门禁口径 = 最终题（K3 D3 复审 Q1）：每道生成的题都必须有可定位引用。
  const citationFinalTotal = stats.citationFinalTotal ?? 0;
  const citationFinalRate =
    citationFinalTotal === 0 ? null : (stats.citationFinalLocated ?? 0) / citationFinalTotal;
  // 过程指标：分母是"模型产出 answer_quote 的次数"——题位失败、计划题位都不该进分母，
  // 否则会算出 >100% 或把没生成出来的题算成引用失败。
  const citationRate =
    stats.citationAttempts === 0 ? null : stats.citationLocated / stats.citationAttempts;
  const blindRate =
    stats.blindSolveAttempts === 0 ? null : stats.blindSolvePasses / stats.blindSolveAttempts;
  const contrastRate =
    stats.contrastAttempts === 0 ? null : stats.contrastPasses / stats.contrastAttempts;
  const distractorErrorRate =
    stats.distractorAttempts === 0
      ? null
      : (stats.distractorAttempts - stats.distractorPasses) / stats.distractorAttempts;

  const autoVerdict = (passed: boolean | null): string =>
    passed === null ? '无样本' : passed ? '✅ 达标' : '❌ 未达标';

  return [
    {
      name: '文字层字符提取准确率',
      threshold: '≥98%',
      value: '需与原文件逐字对照',
      verdict: '待人工',
    },
    {
      name: '切块边界合理',
      threshold: '≥95%',
      value: '见 chunks-review.md',
      verdict: '待人工',
    },
    {
      name: '知识点召回（对比人工清单）',
      threshold: '≥75%',
      value: `抽取 ${stats.kpExtracted} / 目标 ${stats.kpTarget}`,
      verdict: '待人工核对覆盖',
    },
    {
      name: '首次 schema 合法率',
      threshold: '≥90%',
      value:
        stats.schemaFirstPassRate === null
          ? '0/0'
          : `${(stats.schemaFirstPassRate * 100).toFixed(1)}%（${stats.llmCalls} 次结构化调用，${stats.repairCalls} 次修复；一次修复后合法 ${
              stats.schemaAfterRepairRate === null
                ? '—'
                : `${(stats.schemaAfterRepairRate * 100).toFixed(1)}%`
            }）`,
      verdict: autoVerdict(
        stats.schemaFirstPassRate === null ? null : stats.schemaFirstPassRate >= 0.9,
      ),
    },
    {
      name: '引用可定位（最终题，发布门禁口径）',
      threshold: '100%',
      value:
        citationFinalRate === null
          ? '0/0'
          : `${(citationFinalRate * 100).toFixed(1)}%（${ratio(stats.citationFinalLocated ?? 0, citationFinalTotal)} 道生成的题都有可定位引用）`,
      verdict: autoVerdict(citationFinalRate === null ? null : citationFinalRate >= 1),
    },
    {
      name: '引用首次定位率（过程指标）',
      threshold: '软目标 ≥90%',
      value:
        citationRate === null
          ? '0/0'
          : `${(citationRate * 100).toFixed(1)}%（${ratio(stats.citationLocated, stats.citationAttempts)} 次 quote 定位成功，分母=模型产出的 answer_quote 次数；重试后需重新过 citation_supports）`,
      verdict:
        citationRate === null ? '无样本' : citationRate >= 0.9 ? '✅ 过程目标达标' : '⚠ 未达软目标（不 block 发布）',
    },
    {
      name: '盲解一致率（难度 ≤3）',
      threshold: '≥90%',
      value:
        blindRate === null
          ? '无样本'
          : `${(blindRate * 100).toFixed(1)}%（${ratio(stats.blindSolvePasses, stats.blindSolveAttempts)} 次）`,
      verdict: autoVerdict(blindRate === null ? null : blindRate >= 0.9),
    },
    {
      name: '给答案反证：无第二可辩护答案（难度 4–5，题级）',
      threshold: '≥95%',
      value:
        contrastRate === null
          ? '无样本'
          : `${(contrastRate * 100).toFixed(1)}%（${ratio(stats.contrastPasses, stats.contrastAttempts)} 道，分母=最终生成且难度≥4 的题）`,
      verdict: autoVerdict(contrastRate === null ? null : contrastRate >= 0.95),
    },
    {
      name: '干扰项误判率（"错项"其实成立）',
      threshold: '≤5%',
      value:
        distractorErrorRate === null
          ? '无样本'
          : `${(distractorErrorRate * 100).toFixed(1)}%（${ratio(stats.distractorPasses, stats.distractorAttempts)} 题通过质询）`,
      verdict: autoVerdict(distractorErrorRate === null ? null : distractorErrorRate <= 0.05),
    },
    {
      name: '高难题占比（难度 4–5，自动发布题中）',
      threshold: '≥15%',
      value:
        stats.highDifficultyShare === null
          ? '无自动发布题'
          : `${(stats.highDifficultyShare * 100).toFixed(1)}%（当前策略：难度 4–5 一律转人工，故恒为 0；生成题中占 ${
              stats.highDifficultyGeneratedShare === null
                ? '—'
                : `${(stats.highDifficultyGeneratedShare * 100).toFixed(1)}%`
            }）`,
      verdict: '⏸ 门禁解除后评估（K3 D3 Major 1）',
    },
    {
      name: '自动发布率（参考，不是门槛）',
      threshold: '—',
      value: `${ratio(stats.autoPassed, stats.generated)} 题`,
      verdict: '参考',
    },
    {
      name: '人工"可直接使用"',
      threshold: '≥70%',
      value: '见上表人工列',
      verdict: '待人工',
    },
    {
      name: '人工硬错误率',
      threshold: '≤5%',
      value: '见上表"硬错误分类"列',
      verdict: '待人工',
    },
    {
      name: '单份材料成本',
      threshold: '≤¥6',
      value: `¥${stats.costCny.toFixed(2)}（输入 ${stats.inputTokens} tok / 输出 ${stats.outputTokens} tok / 缓存命中 ${stats.cacheHits}${
        stats.costFromCachedRun ? '；本次全缓存，成本与延迟沿用上一次非缓存运行' : ''
      }）`,
      verdict: autoVerdict(stats.costCny <= 6),
    },
    {
      name: '单题流水线 p95 延迟',
      threshold: '100 页整份 <10 分钟',
      value: `平均 ${(stats.avgLatencyMs / 1000).toFixed(1)}s / p95 ${(stats.p95LatencyMs / 1000).toFixed(1)}s（逐题，非整份）`,
      verdict: '参考',
    },
  ];
}

export function buildMetricsTable(stats: SpikeStats): string {
  const header = '| 指标 | 计划门槛 | 本次结果 | 判定 |';
  const divider = '|---|---|---|---|';
  const rows = buildMetricRows(stats).map(
    (row) => `| ${row.name} | ${row.threshold} | ${escapeCell(row.value)} | ${row.verdict} |`,
  );
  return [header, divider, ...rows].join('\n');
}

function buildKpTable(result: SpikeResult): string {
  const rows = result.kps.map(
    (entry, index) =>
      `| ${index + 1} | ${escapeCell(entry.kp.name)} | ${entry.kp.importance} | ${entry.kp.difficulty} | ${entry.kp.examFrequency} | ${entry.chunks.map((chunk) => chunk.ordinal).join(', ')} | ${escapeCell(truncate(entry.kp.summary, 50))} |`,
  );
  return [
    '| # | 知识点 | importance | difficulty | 考频 | 切块 | 摘要 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function buildMisconceptionTable(result: SpikeResult): string {
  if (result.misconceptions.length === 0) {
    return '（本材料没有产出易错点）';
  }
  const kpName = new Map(result.kps.map((entry) => [entry.kp.id, entry.kp.name]));
  const rows = result.misconceptions.map(
    (item, index) =>
      `| ${index + 1} | ${escapeCell(kpName.get(item.kpId) ?? item.kpId)} | ${escapeCell(truncate(item.statement, 50))} | ${escapeCell(truncate(item.whyTempting, 40))} | ${item.severity} |`,
  );
  return [
    '| # | 知识点 | 错误命题 | 为什么诱人 | 严重度 |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function buildFailureTable(result: SpikeResult): string {
  if (result.failures.length === 0) {
    return '（无失败）';
  }
  const rows = result.failures.map(
    (failure) =>
      `| ${escapeCell(failure.slot || '-')} | ${escapeCell(failure.kpName || '-')} | ${failure.stage} | ${escapeCell(truncate(failure.message, 120))} | ¥${failure.costCny.toFixed(4)} |`,
  );
  return ['| 题位 | 知识点 | 阶段 | 原因 | 成本 |', '|---|---|---|---|---|', ...rows].join('\n');
}

export interface SpikeReportInput {
  readonly materialPath: string;
  readonly pageCount: number;
  readonly charCount: number;
  readonly language: string;
  /** 启发式判定结果；与 language 不同说明被 --lang 覆盖（K3 D3 复审 Major 5） */
  readonly detectedLanguage?: string;
  readonly strippedEdgeLines?: readonly string[];
  readonly chunkCount: number;
  readonly normalizationVersion: string;
  readonly contentHash: string;
  readonly elapsedMs: number;
  /** 代码指纹（K3 D3 Minor 1）：工作区不是 git 仓库，用源码哈希锚定版本 */
  readonly codeDigest?: string;
  readonly result: SpikeResult;
}

export function buildSpikeReport(input: SpikeReportInput): string {
  const { stats } = input.result;
  const timestamp = new Date().toISOString();

  return [
    `# D3 Week 0 Spike 报告（自动生成）`,
    '',
    `- 材料：\`${input.materialPath}\``,
    `- 生成时间：${timestamp}`,
    `- 语言：${input.language}${
      input.detectedLanguage && input.detectedLanguage !== input.language
        ? `（人工覆盖，启发式判定 ${input.detectedLanguage}）`
        : ''
    }；页数：${input.pageCount}；字符数：${input.charCount}；切块：${input.chunkCount}`,
    `- 归一化版本：${input.normalizationVersion}；contentHash：\`${input.contentHash.slice(0, 16)}\``,
    ...(input.codeDigest ? [`- 代码指纹：\`${input.codeDigest}\``] : []),
    `- 总耗时：${(input.elapsedMs / 1000).toFixed(1)}s（含 LLM 调用）`,
    '',
    '## 门槛记分卡',
    '',
    '> 需要人下结论的项一律标「待人工」；自动指标不冒充人工结论。',
    '',
    buildMetricsTable(stats),
    '',
    '## 题目人工复核表',
    '',
    '> 判断标准：答案是否唯一且由原文支持；错误项是否对应一个真实误区；解析是否逐项说明；难度是否与标注相符。',
    '> 人工列留空，复核时填写；硬错误分类用：`wrong_key / ambiguous / multiple_defensible / unsupported_explanation / bad_distractor / trivial / formatting`。',
    ...(input.strippedEdgeLines && input.strippedEdgeLines.length > 0
      ? [
          '',
          `> 已剥离的跨页重复首尾行（启发式，请留意是否误删正文）：${input.strippedEdgeLines.map((line) => `\`${line}\``).join('、')}`,
        ]
      : []),
    '',
    buildQuestionReviewTable(input.result),
    '',
    '## 知识点',
    '',
    buildKpTable(input.result),
    '',
    '## 易错点',
    '',
    buildMisconceptionTable(input.result),
    '',
    '## 生成与质检失败',
    '',
    buildFailureTable(input.result),
    '',
    '## 运行告警',
    '',
    input.result.warnings.length === 0
      ? '（无）'
      : input.result.warnings.map((warning) => `- ${warning}`).join('\n'),
    '',
  ].join('\n');
}

export function buildQuestionDetailMarkdown(result: SpikeResult): string {
  const sections = result.questions.map((record, index) => {
    const question = record.question;
    const options = question.options
      .map((option) => {
        const marker = question.answer.includes(option.id) ? ' ✅' : '';
        return `- ${option.id}. ${option.text}${marker}`;
      })
      .join('\n');
    const ref = question.sourceRefs[0];
    const checks = record.checks
      .map((check) => {
        // soft 检查的 passed 只在满分时为 true；门禁用加权分，展示也按分数来，不写"未通过"
        const verdict =
          check.severity === 'hard'
            ? check.passed
              ? '通过'
              : '未通过'
            : `得分 ${(check.score ?? 0).toFixed(2)}`;
        return `- [${check.severity === 'hard' ? '硬' : '软'}] ${check.type}：${verdict}${check.detail ? ` — ${check.detail}` : ''}`;
      })
      .join('\n');
    const blind =
      record.verification.blindSolve.length > 0
        ? record.verification.blindSolve
            .map(
              (item) =>
                `- ${item.variant}：${item.answerLetters.join('') || '调用失败'} → ${item.correct ? '正确' : '错误'}`,
            )
            .join('\n')
        : record.verification.answerContrast
          ? `- 参考意见（不阻断）：${
              record.verification.answerContrast.secondAnswerDefensible
                ? '存在可辩护的第二答案 → '
                : '未发现第二答案 → '
            }${record.verification.answerContrast.detail}`
          : '（不适用）';

    return [
      `### ${index + 1}. ${question.stem}`,
      '',
      options,
      '',
      `**答案**：${question.answer.join(', ')} · **难度**：${question.difficultyEst} · **知识点**：${record.kpName}`,
      '',
      `**解析**：${question.explanation}`,
      '',
      `**答案依据**：${ref ? `「${ref.quote}」（第 ${ref.pageNo} 页，偏移 ${ref.charStart}–${ref.charEnd}）` : '（无）'}`,
      '',
      '',
      '**盲解/反证**：',
      '',
      blind,
      '',
      '**校验明细**：',
      '',
      checks,
      '',
      `**发布门禁**：${record.decision.canPublish ? '可自动发布' : `阻断（${record.decision.reasons.join(', ')}）`}；soft = ${record.decision.softScore.toFixed(3)}；适用 hard check = ${record.applicableHardChecks.join(', ')}`,
      '',
      '---',
      '',
    ].join('\n');
  });

  return ['# Spike 题目明细', '', ...sections].join('\n');
}
