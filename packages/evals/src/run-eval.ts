/**
 * D3 Week 0 Spike CLI。
 *
 *   pnpm eval -- --material <path> [--out <dir>] [--items <n>] [--kp-limit <n>]
 *                [--max-chunks <n>] [--budget <cny>] [--no-cache] [--parse-only]
 *
 * 默认跑完整链路：解析 → 归一化 → 切块 → 考点 → 易错点 → 蓝图扇出 → 单题生成 → 质检 → 发布门禁。
 * `--parse-only` 只跑到切块，用来复核解析质量而不花 token。
 *
 * 产出（默认写到 data/evals/<文件名>-<hash8>/）：
 *   document.json        解析与归一化元信息
 *   normalized.txt       归一化全文——引用坐标系的基准
 *   chunks.json          切块
 *   review.md            切块人工复核表
 *   kps.json             知识点
 *   misconceptions.json  易错点
 *   questions.json       题目 + 全部校验 + 发布结论
 *   failures.json        生成/质检失败记录
 *   stats.json           门槛指标、token、成本
 *   spike-report.md      门槛记分卡 + 题目人工复核表
 *   question-details.md  逐题明细（选项、解析、引用、校验）
 *
 * 本文件是组合根（CLI），允许直接 import infrastructure；web/worker 的同类限制不适用于 evals。
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { countHanInHead, targetKpCount, type MaterialLanguage } from '@qgen/domain';
import { loadConfig, REPO_ROOT } from '@qgen/config';

import { createSqliteDb } from '@qgen/infrastructure/db/client';
import { QwenClient, SqliteLlmCache, LlmConfigError } from '@qgen/infrastructure/llm/qwen-client';
import { chunkDocument } from '@qgen/infrastructure/parsing/chunker';
import { extractDocument } from '@qgen/infrastructure/parsing/extract';
import { normalizeDocument } from '@qgen/infrastructure/parsing/normalize-document';

import {
  buildQuestionDetailMarkdown,
  buildSpikeReport,
  escapeCell,
} from './pipeline/report.ts';
import { runSpike, type SpikeStats } from './pipeline/spike.ts';

interface CliOptions {
  readonly material: string;
  readonly out: string | null;
  readonly items: number | null;
  readonly kpLimit: number | null;
  readonly maxChunks: number;
  readonly budgetCny: number | null;
  readonly useCache: boolean;
  readonly parseOnly: boolean;
  /** 人工覆盖语言判定（K3 D3 复审 Major 5）；null = 用启发式结果 */
  readonly lang: MaterialLanguage | null;
}

function positiveInt(value: string | undefined, flag: string): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} 必须是正整数，收到: ${value}`);
  }
  return parsed;
}

function parseCli(): CliOptions {
  // pnpm 会把 `pnpm eval -- --material x` 里的 `--` 原样传进来，先剥掉
  const argv = process.argv.slice(2);
  if (argv[0] === '--') {
    argv.shift();
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      material: { type: 'string' },
      out: { type: 'string' },
      items: { type: 'string' },
      'kp-limit': { type: 'string' },
      'max-chunks': { type: 'string' },
      budget: { type: 'string' },
      lang: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      'parse-only': { type: 'boolean', default: false },
    },
  });

  if (!values.material) {
    throw new Error(
      '用法: pnpm eval -- --material <path> [--out <dir>] [--items <n>] [--kp-limit <n>] [--max-chunks <n>] [--budget <cny>] [--lang zh|en] [--no-cache] [--parse-only]',
    );
  }

  const budget = values.budget === undefined ? null : Number.parseFloat(values.budget);
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    throw new Error(`--budget 必须是正数，收到: ${values.budget}`);
  }

  const lang = values.lang ?? null;
  if (lang !== null && lang !== 'zh' && lang !== 'en') {
    throw new Error(`--lang 只能是 zh 或 en，收到: ${values.lang}`);
  }

  return {
    material: values.material,
    out: values.out ?? null,
    items: positiveInt(values.items, '--items'),
    kpLimit: positiveInt(values['kp-limit'], '--kp-limit'),
    maxChunks: positiveInt(values['max-chunks'], '--max-chunks') ?? 30,
    budgetCny: budget,
    useCache: !values['no-cache'],
    parseOnly: values['parse-only'],
    lang: lang as MaterialLanguage | null,
  };
}

/** 语言检测的诊断信息：只用于报告，判定仍由 domain.detectLanguage 负责 */
function languageSignals(text: string): {
  han: number;
  latin: number;
  hanRatio: number;
  /** 前 2000 字符内汉字数（K3 Major 5 的第三条件信号） */
  hanHead: number;
} {
  let han = 0;
  let latin = 0;
  for (const char of text) {
    if (/\p{Script=Han}/u.test(char)) {
      han += 1;
    } else if (/\p{Letter}/u.test(char)) {
      latin += 1;
    }
  }
  const total = han + latin;
  return {
    han,
    latin,
    hanRatio: total === 0 ? 0 : Number((han / total).toFixed(3)),
    hanHead: countHanInHead(text),
  };
}

function buildChunkReviewTable(chunks: ReturnType<typeof chunkDocument>): string {
  const rows = chunks.map((chunk) => {
    const excerpt = chunk.text.replace(/\s+/g, ' ').slice(0, 80);
    const heading = chunk.headingPath.length > 0 ? chunk.headingPath.join(' > ') : '（无）';
    return `| ${chunk.ordinal} | ${chunk.pageStart ?? '-'}–${chunk.pageEnd ?? '-'} | ${escapeCell(heading)} | ${chunk.text.length} | ${escapeCell(excerpt)} |  |  |  |`;
  });

  return [
    '| # | 页码 | 标题路径 | 字数 | 开头 80 字 | 边界合理 | 标题正确 | 备注 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

async function main(): Promise<void> {
  const options = parseCli();
  const config = loadConfig();
  const materialPath = resolve(options.material);

  const extracted = await extractDocument(materialPath);
  const document = normalizeDocument(extracted.pages);
  const detectedLanguage = document.language;
  // --lang 优先：启发式永远会漏（英文论文贴中文封面等），用户一键纠偏是兜底
  const language: MaterialLanguage = options.lang ?? detectedLanguage;
  const materialId = `eval-${document.contentHash.slice(0, 8)}`;
  const chunks = chunkDocument(document, materialId);

  const outDir =
    options.out !== null
      ? resolve(options.out)
      : resolve(
          REPO_ROOT,
          'data',
          'evals',
          `${basename(materialPath, extname(materialPath))}-${document.contentHash.slice(0, 8)}`,
        );
  await mkdir(outDir, { recursive: true });

  const lengths = chunks.map((chunk) => chunk.text.length);
  const totalChars = lengths.reduce((sum, value) => sum + value, 0);
  const coverage = document.charCount === 0 ? 0 : totalChars / document.charCount;

  const meta = {
    material: materialPath,
    sourceType: extracted.sourceType,
    materialId,
    pageCount: document.pages.length,
    charCount: document.charCount,
    language,
    detectedLanguage,
    languageOverride: options.lang,
    languageSignals: languageSignals(document.normalizedText),
    normalizationVersion: document.normalizationVersion,
    contentHash: document.contentHash,
    strippedEdgeLines: document.strippedEdgeLines,
    chunkCount: chunks.length,
    chunkChars: {
      min: lengths.length > 0 ? Math.min(...lengths) : 0,
      max: lengths.length > 0 ? Math.max(...lengths) : 0,
      avg: lengths.length > 0 ? Math.round(totalChars / lengths.length) : 0,
      coverage: Number(coverage.toFixed(4)),
    },
    requestedItems: options.items,
    mode: options.parseOnly ? 'parse-only' : 'full',
  };

  const baseFiles: Array<[string, string]> = [
    ['document.json', `${JSON.stringify(meta, null, 2)}\n`],
    ['normalized.txt', document.normalizedText],
    ['chunks.json', `${JSON.stringify(chunks, null, 2)}\n`],
    [
      'review.md',
      [
        `# 切块人工复核表：${basename(materialPath)}`,
        '',
        `- 语言：${language}${options.lang ? `（--lang 覆盖，启发式判定 ${detectedLanguage}）` : ''}；页数：${document.pages.length}；字符数：${document.charCount}`,
        `- 切块：${chunks.length} 块；字数 min/avg/max = ${meta.chunkChars.min}/${meta.chunkChars.avg}/${meta.chunkChars.max}；覆盖率 ${(coverage * 100).toFixed(1)}%`,
        `- 归一化版本：${document.normalizationVersion}`,
        '',
        buildChunkReviewTable(chunks),
        '',
        '> 判断标准：边界不切断句子/表格；标题路径与该块内容一致；开头 80 字能独立看懂。',
        '',
      ].join('\n'),
    ],
  ];
  await Promise.all(baseFiles.map(([name, content]) => writeFile(resolve(outDir, name), content, 'utf8')));

  console.log(`[eval] ${basename(materialPath)} → ${outDir}`);
  console.log(
    `[eval] 页 ${document.pages.length} · 字符 ${document.charCount} · 语言 ${language}（汉字 ${meta.languageSignals.han} / 占比 ${(meta.languageSignals.hanRatio * 100).toFixed(2)}% / 前 2000 字 ${meta.languageSignals.hanHead}${options.lang ? `；--lang 覆盖，启发式 ${detectedLanguage}` : ''}）· 切块 ${chunks.length}（${meta.chunkChars.min}/${meta.chunkChars.avg}/${meta.chunkChars.max}）· 覆盖 ${(coverage * 100).toFixed(1)}%`,
  );

  if (document.strippedEdgeLines.length > 0) {
    console.log(`[eval] 已剥离跨页重复页眉页脚 ${document.strippedEdgeLines.length} 种：${document.strippedEdgeLines.join(' | ')}`);
  }

  if (options.parseOnly) {
    console.log('[eval] --parse-only：跳过 LLM 阶段');
    return;
  }

  const targetKps = options.kpLimit ?? targetKpCount(document.pages.length);
  const budgetCny = options.budgetCny ?? config.llmBudgetPerMaterialCny;

  const dbPath = resolve(config.dataDir, 'qgen.db');
  const { sqlite, db } = createSqliteDb(dbPath);
  const hasCacheTable =
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_cache'")
      .get() !== undefined;
  const cache = options.useCache && hasCacheTable ? new SqliteLlmCache(db) : null;
  if (!cache) {
    console.warn(
      hasCacheTable
        ? '[eval] 缓存已按 --no-cache 关闭'
        : '[eval] 未找到 llm_cache 表，缓存关闭；先跑 pnpm db:migrate 可让重跑近乎免费',
    );
  }

  const client = new QwenClient({
    apiKey: config.apiKeys.dashscope,
    ...(cache ? { cache } : {}),
    budgetCny,
  });

  const startedAt = Date.now();
  const codeDigest = await computeCodeDigest();
  try {
    const result = await runSpike(
      client,
      {
        materialId,
        document,
        chunks,
        itemLimit: options.items,
        kpLimit: options.kpLimit,
        maxChunks: options.maxChunks,
      },
      language,
      targetKps,
    );
    const elapsedMs = Date.now() - startedAt;
    // 全缓存重跑时 stats 里的成本/延迟会是 0（K3 D3 复审 Minor 1）：
    // 沿用上一次非缓存运行的数值，并标记来源，避免 stats.json 与报告失真。
    const stats = await carryOverCostWhenCached(outDir, result.stats);

    await Promise.all([
      writeFile(
        resolve(outDir, 'kps.json'),
        `${JSON.stringify(result.kps.map((entry) => entry.kp), null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        resolve(outDir, 'misconceptions.json'),
        `${JSON.stringify(result.misconceptions, null, 2)}\n`,
        'utf8',
      ),
      writeFile(resolve(outDir, 'questions.json'), `${JSON.stringify(result.questions, null, 2)}\n`, 'utf8'),
      writeFile(resolve(outDir, 'failures.json'), `${JSON.stringify(result.failures, null, 2)}\n`, 'utf8'),
      writeFile(resolve(outDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8'),
      writeFile(
        resolve(outDir, 'spike-report.md'),
        buildSpikeReport({
          materialPath,
          pageCount: document.pages.length,
          charCount: document.charCount,
          language,
          detectedLanguage,
          strippedEdgeLines: document.strippedEdgeLines,
          chunkCount: chunks.length,
          normalizationVersion: document.normalizationVersion,
          contentHash: document.contentHash,
          elapsedMs,
          codeDigest,
          result: { ...result, stats },
        }),
        'utf8',
      ),
      writeFile(resolve(outDir, 'question-details.md'), buildQuestionDetailMarkdown(result), 'utf8'),
    ]);

    // 成本台账（K3 D3 Minor 1）：只有真正发生调用的运行才记账；
    // 追加写入，不覆盖——全缓存重跑不再抹掉上一次的真实成本。
    if (stats.llmCalls > 0) {
      await appendFile(
        resolve(outDir, '..', 'cost-ledger.jsonl'),
        `${JSON.stringify({
          at: new Date().toISOString(),
          material: materialPath,
          outDir: basename(outDir),
          items: options.items ?? null,
          codeDigest,
          costCny: stats.costCny,
          llmCalls: stats.llmCalls,
          cacheHits: stats.cacheHits,
          generated: stats.generated,
          autoPassed: stats.autoPassed,
          needsReview: stats.needsReview,
          failed: stats.failed,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          // 复审 Minor 1：p95 目前在终端输出里易丢，随台账落盘
          p95Ms: stats.p95LatencyMs,
          avgLatencyMs: stats.avgLatencyMs,
        })}\n`,
        'utf8',
      );
    }

    console.log(
      `[eval] 知识点 ${stats.kpExtracted}/${stats.kpTarget} · 题位 ${stats.plannedSlots} · 生成 ${stats.generated} · 自动发布 ${stats.autoPassed} · 待复核 ${stats.needsReview} · 失败 ${stats.failed}`,
    );
    console.log(
      `[eval] 成本 ¥${stats.costCny.toFixed(3)} · 调用 ${stats.llmCalls} · 缓存命中 ${stats.cacheHits} · 修复 ${stats.repairCalls} · p95 ${(stats.p95LatencyMs / 1000).toFixed(1)}s · 总耗时 ${(elapsedMs / 1000).toFixed(1)}s`,
    );
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.warn(`[eval] 告警：${warning}`);
      }
    }
  } finally {
    sqlite.close();
  }
}

/**
 * 全缓存重跑会把 stats.json 里的成本与 p95 覆盖成 0。
 * 继承上一次非缓存运行的这几个字段，并标记 `costFromCachedRun`，
 * 让 stats.json / spike-report.md 不再显示"0 元 0 秒"的假数据（K3 D3 复审 Minor 1）。
 */
async function carryOverCostWhenCached(outDir: string, stats: SpikeStats): Promise<SpikeStats> {
  if (stats.llmCalls > 0) {
    return stats;
  }

  let previous: Partial<SpikeStats>;
  try {
    previous = JSON.parse(await readFile(resolve(outDir, 'stats.json'), 'utf8')) as Partial<SpikeStats>;
  } catch {
    return stats;
  }

  const p95 = previous.p95LatencyMs;
  if (typeof p95 !== 'number' || p95 <= 0) {
    return stats;
  }

  return {
    ...stats,
    costCny: typeof previous.costCny === 'number' ? previous.costCny : stats.costCny,
    costPerQuestionCny:
      previous.costPerQuestionCny === undefined ? stats.costPerQuestionCny : previous.costPerQuestionCny,
    inputTokens: typeof previous.inputTokens === 'number' ? previous.inputTokens : stats.inputTokens,
    outputTokens: typeof previous.outputTokens === 'number' ? previous.outputTokens : stats.outputTokens,
    avgLatencyMs: typeof previous.avgLatencyMs === 'number' ? previous.avgLatencyMs : stats.avgLatencyMs,
    p95LatencyMs: p95,
    costFromCachedRun: true,
  };
}

/**
 * 工作区不是 git 仓库，用源码文件内容哈希作为"代码版本"锚点，
 * 写入每次非全缓存运行的 cost-ledger.jsonl 与 spike-report.md（K3 D3 Minor 1）。
 */
async function computeCodeDigest(): Promise<string> {
  const roots = [
    'packages/domain/src',
    'packages/application/src',
    'packages/contracts/src',
    'packages/config/src',
    'packages/evals/src',
    'packages/infrastructure/src',
    'apps/web/src',
    'apps/worker/src',
  ];
  const files: string[] = [];

  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(resolve(REPO_ROOT, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(child);
      }
    }
  };

  for (const root of roots) {
    await walk(root);
  }
  files.sort();

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(resolve(REPO_ROOT, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

main().catch((error: unknown) => {
  if (error instanceof LlmConfigError) {
    console.error(`[eval] ${error.message}`);
  } else {
    console.error(`[eval] 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
