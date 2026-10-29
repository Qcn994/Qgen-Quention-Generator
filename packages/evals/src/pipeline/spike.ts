/**
 * D3 Week 0 Spike 的 LLM 段：考点 → 易错点 → 蓝图扇出 → 单题生成 → 质检 → 发布门禁。
 *
 * 设计约束（计划第五、六节 + K3 第五轮裁决）：
 * - 一次只生成一道题，失败隔离；
 * - 引用坐标由我们在 normalized_text 里反算，不信任模型给的偏移；
 * - 4 个 soft check 必须全部出具，缺一即本次质检无效（zod 直接拒绝）；
 * - 质检按难度分层：≤3 盲解 2/2；4–5 给答案反证、不得有第二可辩护答案；
 * - moderation 在 M0 不接（阿里云内容安全属于 M1），显式排除在适用集合之外，
 *   而不是"没跑就算过"。
 */

import { createHash } from 'node:crypto';

import type { z } from 'zod';

import {
  allocateQuestionsPerKp,
  checkCitation,
  createKnowledgePoint,
  createMisconception,
  evaluatePublish,
  hardCheck,
  idempotencyKeyMaterial,
  seedFromDigestHex,
  seedMaterial,
  softCheck,
  targetQuestionCount,
  typeDistribution,
  type Chunk,
  type HardCheckType,
  type KnowledgePoint,
  type MaterialLanguage,
  type Misconception,
  type PublishDecision,
  type Question,
  type QuestionCheck,
  type QuestionType,
} from '@qgen/domain';

import { LlmBudgetError } from '@qgen/infrastructure/llm/qwen-client';
import type {
  LlmCompletion,
  LlmMessage,
  QwenClient,
  QwenModel,
} from '@qgen/infrastructure/llm/qwen-client';
import { buildAnswerContrastMessages, ANSWER_CONTRAST_PROMPT_VERSION } from '@qgen/infrastructure/llm/prompts/answer-contrast.v2';
import { buildBlindSolveMessages, BLIND_SOLVE_PROMPT_VERSION, type BlindSolveVariant } from '@qgen/infrastructure/llm/prompts/blind-solve.v1';
import { buildGenerateQuestionMessages, GENERATE_QUESTION_PROMPT_VERSION } from '@qgen/infrastructure/llm/prompts/generate-question.v2';
import { buildKpExtractMessages, KP_EXTRACT_PROMPT_VERSION } from '@qgen/infrastructure/llm/prompts/kp-extract.v1';
import { buildMisconceptionMessages, MISCONCEPTION_PROMPT_VERSION } from '@qgen/infrastructure/llm/prompts/misconception.v1';
import { buildVerifyQuestionMessages, VERIFY_QUESTION_PROMPT_VERSION } from '@qgen/infrastructure/llm/prompts/verify-question.v1';
import type { NormalizedDocument } from '@qgen/infrastructure/parsing/normalize-document';

import { locateQuote, pageForOffset } from './locate-quote.ts';
import {
  answerContrastSchema,
  blindSolveSchema,
  formatZodError,
  generatedQuestionSchema,
  kpResponseSchema,
  misconceptionResponseSchema,
  verifyResponseSchema,
  type GeneratedQuestionOutput,
  type VerifyResponseOutput,
} from './schemas.ts';
import { isDuplicate, simhash64, simhashToHex, stemKey } from './simhash.ts';

/** M0 单厂商：抽取/盲解用 plus，生成/质检用 max（强档），成本与质量折中 */
const MODEL_FOR = {
  kp: 'qwen-plus',
  misconception: 'qwen-max',
  generate: 'qwen-max',
  verify: 'qwen-max',
  blind: 'qwen-plus',
  contrast: 'qwen-plus',
} as const satisfies Record<string, QwenModel>;

const OPTION_IDS = ['A', 'B', 'C', 'D'] as const;

export interface SpikeOptions {
  readonly materialId: string;
  readonly document: NormalizedDocument;
  readonly chunks: readonly Chunk[];
  readonly itemLimit: number | null;
  readonly kpLimit: number | null;
  readonly maxChunks: number;
}

export interface StoredKp {
  readonly kp: KnowledgePoint;
  readonly chunks: readonly Chunk[];
}

export interface BlindSolveRecord {
  readonly variant: BlindSolveVariant;
  readonly answerLetters: readonly string[];
  readonly correct: boolean;
  readonly reasoning: string;
}

export interface QuestionRecord {
  readonly question: Question;
  readonly checks: readonly QuestionCheck[];
  readonly decision: PublishDecision;
  readonly applicableHardChecks: readonly HardCheckType[];
  readonly simhash: string;
  readonly kpName: string;
  readonly generation: {
    readonly idempotencyKey: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly seed: number;
    readonly latencyMs: number;
  };
  readonly verification: {
    readonly citationMatch: 'exact' | 'collapsed' | 'folded';
    readonly blindSolve: readonly BlindSolveRecord[];
    readonly answerContrast: { readonly secondAnswerDefensible: boolean; readonly detail: string } | null;
  };
  readonly costCny: number;
  readonly latencyMs: number;
}

export type FailureStage = 'kp_extract' | 'generation' | 'citation' | 'duplicate' | 'verify';

export interface FailureRecord {
  readonly slot: string;
  readonly kpName: string;
  readonly stage: FailureStage;
  readonly message: string;
  readonly costCny: number;
}

export interface SpikeStats {
  readonly requestedItems: number;
  readonly plannedSlots: number;
  readonly generated: number;
  readonly autoPassed: number;
  readonly needsReview: number;
  readonly failed: number;
  readonly duplicateHits: number;
  readonly citationLocated: number;
  readonly blindSolveAttempts: number;
  readonly blindSolvePasses: number;
  readonly contrastAttempts: number;
  readonly contrastPasses: number;
  readonly distractorAttempts: number;
  readonly distractorPasses: number;
  readonly schemaFirstPassRate: number | null;
  /** 一次（带错误路径的）修复调用后合法的比例；修复成功不算首过（K3 D3 Q3 裁决） */
  readonly schemaAfterRepairRate: number | null;
  readonly repairCalls: number;
  /** kp_extract 块级结构化失败的降载修复次数（K3 D3 Major 2） */
  readonly kpBlockRepairCount: number;
  /** 生成失败后换题型补位的次数与成功数（K3 D3 Major 3） */
  readonly reallocationRetries: number;
  readonly reallocationSuccess: number;
  /** 自动发布题中难度 4–5 的占比；Major 1 之后该值恒为 0，见 highDifficultyGeneratedShare */
  readonly highDifficultyShare: number | null;
  /** 最终生成题（含待复核）中难度 4–5 的占比，用于看难度覆盖是否真的被门禁遮住 */
  readonly highDifficultyGeneratedShare: number | null;
  readonly softScoreAvg: number | null;
  readonly kpTarget: number;
  readonly kpExtracted: number;
  readonly kpUsed: number;
  readonly costCny: number;
  readonly costPerQuestionCny: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHits: number;
  readonly llmCalls: number;
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  /** 需要人工复核才能算；自动段不给假数字 */
  readonly hardErrorRate: number | null;
}

export interface SpikeResult {
  readonly kps: readonly StoredKp[];
  readonly misconceptions: readonly Misconception[];
  readonly questions: readonly QuestionRecord[];
  readonly failures: readonly FailureRecord[];
  readonly stats: SpikeStats;
  readonly warnings: readonly string[];
}

class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

/** 结构化输出的通过率埋点：修复调用会真实花钱，必须可见 */
export interface StructuredCounters {
  calls: number;
  firstPass: number;
  /** 第一次失败、第二次（带错误路径的修复调用）通过 */
  repairedPass: number;
  repairs: number;
  failures: number;
}

export function createStructuredCounters(): StructuredCounters {
  return { calls: 0, firstPass: 0, repairedPass: 0, repairs: 0, failures: 0 };
}

async function callStructured<T>(
  client: QwenClient,
  schema: z.ZodType<T>,
  input: {
    model: QwenModel;
    messages: readonly LlmMessage[];
    promptVersion: string;
    temperature?: number;
    seed?: number;
    maxTokens?: number;
  },
  counters: StructuredCounters,
): Promise<{ data: T; completion: LlmCompletion }> {
  let messages = [...input.messages];
  let lastError = '';
  let raw = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    counters.calls += 1;
    const completion = await client.complete({ ...input, messages });
    raw = completion.text;
    try {
      const parsed: unknown = JSON.parse(raw);
      const result = schema.safeParse(parsed);
      if (result.success) {
        if (attempt === 0) {
          counters.firstPass += 1;
        } else {
          counters.repairedPass += 1;
        }
        return { data: result.data, completion };
      }
      lastError = formatZodError(result.error);
    } catch (error) {
      lastError = `不是合法 JSON：${error instanceof Error ? error.message : String(error)}`;
    }

    if (attempt === 0) {
      counters.repairs += 1;
    }

    messages = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `上一次输出未通过校验：${lastError}\n请只输出修正后的完整 JSON，不要输出任何其他内容。`,
      },
    ];
  }

  counters.failures += 1;
  throw new StructuredOutputError(`结构化输出两次未通过校验：${lastError}`, raw);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonicalName(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function selectChunks(chunks: readonly Chunk[], maxChunks: number): Chunk[] {
  if (chunks.length <= maxChunks) {
    return [...chunks];
  }
  const step = chunks.length / maxChunks;
  const selected: Chunk[] = [];
  for (let index = 0; index < maxChunks; index += 1) {
    const chunk = chunks[Math.floor(index * step)];
    if (chunk) {
      selected.push(chunk);
    }
  }
  return selected;
}

interface MergedKp {
  kp: KnowledgePoint;
  chunks: Chunk[];
}

async function extractKnowledgePoints(
  client: QwenClient,
  options: SpikeOptions,
  language: MaterialLanguage,
  targetKps: number,
  warnings: string[],
  failures: FailureRecord[],
  counters: StructuredCounters,
  kpCounters: { blockRepairs: number },
): Promise<MergedKp[]> {
  const selected = selectChunks(options.chunks, options.maxChunks);
  const perChunk = Math.min(8, Math.max(2, Math.ceil(targetKps / Math.max(1, selected.length)) + 1));
  const byName = new Map<string, MergedKp>();
  let ordinal = 0;

  for (const chunk of selected) {
    const baseMessages = buildKpExtractMessages({
      language,
      headingPath: chunk.headingPath,
      text: chunk.text,
      maxKps: perChunk,
    });

    let messages = baseMessages;
    // 真实材料上模型常用省略号把多处文字拼成一个 source_quote（实测 19 个考点丢 7 个），
    // 定位失败就带着失败样本重抽一次，而不是直接丢弃。
    // K3 D3 Major 2：结构化失败（zod）也要再给一次"降载"修复，不能直接放弃整块。
    let kpRepairUsed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let data: z.infer<typeof kpResponseSchema>;
      try {
        const result = await callStructured(client, kpResponseSchema, {
          model: MODEL_FOR.kp,
          messages,
          promptVersion: KP_EXTRACT_PROMPT_VERSION,
          temperature: 0.2,
          maxTokens: 3072,
        }, counters);
        data = result.data;
      } catch (error) {
        if (error instanceof LlmBudgetError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (kpRepairUsed) {
          failures.push({
            slot: '',
            kpName: '',
            stage: 'kp_extract',
            message: `切块 ${chunk.ordinal} 考点抽取失败：${message}`,
            costCny: 0,
          });
          break;
        }
        kpRepairUsed = true;
        kpCounters.blockRepairs += 1;
        try {
          const repaired = await callStructured(client, kpResponseSchema, {
            model: MODEL_FOR.kp,
            messages: [
              ...baseMessages,
              {
                role: 'user',
                content: `上一次输出未通过校验：${message}\n请只输出符合要求的 JSON。如果内容装不下，knowledge_points 最多 3 条，每条 source_quote 只摘一句、逐字复制。`,
              },
            ],
            promptVersion: KP_EXTRACT_PROMPT_VERSION,
            temperature: 0.2,
            maxTokens: 3072,
          }, counters);
          data = repaired.data;
        } catch (again) {
          failures.push({
            slot: '',
            kpName: '',
            stage: 'kp_extract',
            message: `切块 ${chunk.ordinal} 考点抽取失败（含降载修复）：${again instanceof Error ? again.message : String(again)}`,
            costCny: 0,
          });
          break;
        }
      }

      const dropped: Array<{ name: string; quote: string }> = [];

      for (const item of data.knowledge_points) {
        const sourceQuote = item.source_quote.trim();
        const quote = locateQuote([chunk], sourceQuote);
        if (!quote) {
          dropped.push({ name: item.name, quote: sourceQuote });
          continue;
        }

        const key = canonicalName(item.name);
        const existing = byName.get(key);
        if (existing) {
          const merged: KnowledgePoint = {
            ...existing.kp,
            importance: Math.max(existing.kp.importance, item.importance),
            difficulty: Math.max(existing.kp.difficulty, item.difficulty),
            chunkIds: [...new Set([...existing.kp.chunkIds, chunk.id])],
            evidenceQuotes: [...new Set([...existing.kp.evidenceQuotes, quote.quote])],
          };
          byName.set(key, {
            kp: merged,
            chunks: existing.chunks.some((entry) => entry.id === chunk.id)
              ? existing.chunks
              : [...existing.chunks, chunk],
          });
          continue;
        }

        const kp = createKnowledgePoint({
          id: `${options.materialId}-kp${ordinal}`,
          materialId: options.materialId,
          name: item.name,
          summary: item.summary,
          importance: item.importance,
          difficulty: item.difficulty,
          examFrequency: item.exam_frequency,
          chunkIds: [chunk.id],
          evidenceQuotes: [quote.quote],
        });
        ordinal += 1;
        byName.set(key, { kp, chunks: [chunk] });
      }

      if (dropped.length === 0) {
        break;
      }
      if (attempt === 1) {
        for (const item of dropped) {
          warnings.push(`切块 ${chunk.ordinal} 的考点「${item.name}」因引用无法逐字定位被丢弃`);
        }
        break;
      }

      messages = [
        ...baseMessages,
        {
          role: 'user',
          content: `以下 source_quote 未能在原文中逐字找到（可能是改写、用省略号拼接了多处、或跨越了换行）：\n${dropped
            .map((item) => `- ${item.name}：「${item.quote}」`)
            .join('\n')}\n请重新抽取本块考点。source_quote 必须是原文中一段连续出现的文字，逐字复制，禁止使用省略号或任何省略标记；一个考点只摘录最能支撑它的那一句。`,
        },
      ];
    }
  }

  const merged = [...byName.values()].sort(
    (a, b) => b.kp.importance - a.kp.importance || b.kp.difficulty - a.kp.difficulty,
  );

  return options.kpLimit !== null ? merged.slice(0, options.kpLimit) : merged;
}

async function extractMisconceptions(
  client: QwenClient,
  kps: readonly MergedKp[],
  language: MaterialLanguage,
  warnings: string[],
  counters: StructuredCounters,
): Promise<Map<string, Misconception[]>> {
  const byKp = new Map<string, Misconception[]>();

  for (const entry of kps) {
    const sourceText = entry.chunks
      .map((chunk) => chunk.text)
      .join('\n\n')
      .slice(0, 3000);
    const messages = buildMisconceptionMessages({
      language,
      kpName: entry.kp.name,
      kpSummary: entry.kp.summary,
      sourceText,
    });

    try {
      const { data } = await callStructured(client, misconceptionResponseSchema, {
        model: MODEL_FOR.misconception,
        messages,
        promptVersion: MISCONCEPTION_PROMPT_VERSION,
        temperature: 0.4,
        maxTokens: 2048,
      }, counters);

      const list = data.misconceptions.map((item, index) =>
        createMisconception({
          id: `${entry.kp.id}-m${index}`,
          kpId: entry.kp.id,
          statement: item.statement,
          whyTempting: item.why_tempting,
          correctContrast: item.correct_contrast,
          severity: item.severity,
          evidence: item.evidence,
        }),
      );
      byKp.set(entry.kp.id, list);
    } catch (error) {
      warnings.push(
        `考点「${entry.kp.name}」易错点辨析失败（不致命）：${error instanceof Error ? error.message : String(error)}`,
      );
      byKp.set(entry.kp.id, []);
    }
  }

  return byKp;
}

function typeQueue(total: number, language: MaterialLanguage): QuestionType[] {
  const distribution = typeDistribution(total, language);
  const queue: QuestionType[] = [];
  const remaining: Record<QuestionType, number> = { ...distribution };

  while (queue.length < total) {
    let added = false;
    for (const type of ['single_choice', 'multiple_choice', 'true_false'] as const) {
      if (remaining[type] > 0) {
        queue.push(type);
        remaining[type] -= 1;
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }

  return queue;
}

/** 补位告警里的题型中文名（报告层有同名映射，这里是纯文本告警用） */
const TYPE_LABEL_FOR_WARNING: Record<QuestionType, string> = {
  single_choice: '单选',
  multiple_choice: '多选',
  true_false: '判断',
};

interface Slot {
  readonly index: number;
  readonly kp: MergedKp;
  readonly type: QuestionType;
  readonly targetDifficulty: number;
}

function planSlots(
  kps: readonly MergedKp[],
  total: number,
  language: MaterialLanguage,
): Slot[] {
  const allocations = allocateQuestionsPerKp(
    total,
    kps.map((entry) => ({ importance: entry.kp.importance })),
  );
  const types = typeQueue(total, language);
  const slots: Slot[] = [];

  kps.forEach((entry, kpIndex) => {
    const count = allocations[kpIndex] ?? 0;
    for (let offset = 0; offset < count; offset += 1) {
      const type = types[slots.length];
      if (!type) {
        return;
      }
      const bump = type === 'multiple_choice' ? 1 : 0;
      slots.push({
        index: slots.length,
        kp: entry,
        type,
        targetDifficulty: Math.min(5, entry.kp.difficulty + bump),
      });
    }
  });

  // 难度配额（K3 D3 Major 3）：至少 15% 题位把目标难度推到 4，
  // 优先给高 importance 的考点；否则模型自评会一路保守在 2–3。
  const highQuota = Math.round(total * 0.15);
  if (highQuota > 0) {
    const highIndices = new Set(
      slots
        .map((slot, index) => ({ slot, index }))
        .sort(
          (a, b) =>
            b.slot.kp.kp.importance - a.slot.kp.kp.importance || a.index - b.index,
        )
        .slice(0, highQuota)
        .map((entry) => entry.index),
    );
    return slots.map((slot, index) =>
      highIndices.has(index)
        ? { ...slot, targetDifficulty: Math.max(4, slot.targetDifficulty) }
        : slot,
    );
  }

  return slots;
}

type OptionDraft = GeneratedQuestionOutput['options'][number];

interface PreparedQuestion {
  readonly stem: string;
  readonly optionTexts: readonly string[];
  readonly answerIndices: readonly number[];
  readonly explanation: string;
  readonly answerQuote: string;
  readonly difficultyEst: number;
  readonly options: readonly OptionDraft[];
}

function validateGenerated(
  output: GeneratedQuestionOutput,
  type: QuestionType,
  language: MaterialLanguage,
): { ok: true; prepared: PreparedQuestion } | { ok: false; error: string } {
  const indices = [...new Set(output.answer_indices)];

  if (type === 'true_false' && output.options.length !== 2) {
    return { ok: false, error: `判断题必须恰好 2 个选项，收到 ${output.options.length} 个` };
  }
  if (type !== 'true_false' && output.options.length !== 4) {
    return { ok: false, error: `${type} 必须恰好 4 个选项，收到 ${output.options.length} 个` };
  }
  if (indices.length !== output.answer_indices.length) {
    return { ok: false, error: 'answer_indices 有重复项' };
  }
  if (indices.some((index) => index < 0 || index >= output.options.length)) {
    return { ok: false, error: 'answer_indices 越界' };
  }
  if (type === 'single_choice' && indices.length !== 1) {
    return { ok: false, error: '单选题必须恰好 1 个正确选项' };
  }
  if (type === 'multiple_choice' && (indices.length < 2 || indices.length >= output.options.length)) {
    return { ok: false, error: '多选题正确项必须是 2 到 n-1 个' };
  }
  if (type === 'true_false' && indices.length !== 1) {
    return { ok: false, error: '判断题必须恰好 1 个正确选项' };
  }
  if (
    output.options.some(
      (option) =>
        option.misconception_index !== null &&
        (option.misconception_index < 0 || option.misconception_index > 20),
    )
  ) {
    return { ok: false, error: 'misconception_index 越界' };
  }

  if (type === 'true_false') {
    const selected = indices[0] ?? 0;
    const selectedText = (output.options[selected]?.text ?? '').trim();
    const otherText = (output.options[selected === 0 ? 1 : 0]?.text ?? '').trim();
    const truthy = /^(正确|对|true|t)$/i;
    const falsy = /^(错误|错|false|f)$/i;

    let answerIsTrue: boolean | null = null;
    if (truthy.test(selectedText) && falsy.test(otherText)) {
      answerIsTrue = true;
    } else if (falsy.test(selectedText) && truthy.test(otherText)) {
      answerIsTrue = false;
    }
    if (answerIsTrue === null) {
      return {
        ok: false,
        error: '判断题选项文本必须是「正确/错误」（英文 True/False），请重新生成',
      };
    }

    return {
      ok: true,
      prepared: {
        stem: output.stem,
        optionTexts: language === 'zh' ? ['正确', '错误'] : ['True', 'False'],
        answerIndices: [answerIsTrue ? 0 : 1],
        explanation: output.explanation,
        answerQuote: output.answer_quote,
        difficultyEst: output.difficulty_est,
        options: output.options,
      },
    };
  }

  return {
    ok: true,
    prepared: {
      stem: output.stem,
      optionTexts: output.options.map((option) => option.text),
      answerIndices: indices,
      explanation: output.explanation,
      answerQuote: output.answer_quote,
      difficultyEst: output.difficulty_est,
      options: output.options,
    },
  };
}

function lettersIn(value: string, valid: readonly string[]): string[] {
  const upper = value.toUpperCase();
  const found = upper.match(/[A-F]/g) ?? [];
  return [...new Set(found.filter((letter) => valid.includes(letter)))];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function applicableHardChecksFor(difficulty: number): HardCheckType[] {
  const base: HardCheckType[] = [
    'schema',
    'citation_exists',
    'citation_supports',
    'answer_unique',
    'distractor_challenge',
    'duplicate',
  ];
  // moderation 在 M0 未接入，显式不要求；难度分层见计划第六节。
  // K3 D3 Major 1：难度 4–5 在跨厂商质检到位前一律转人工，反证只作参考意见，
  // 因此不进适用集合——否则同厂商的字段-推理不一致会继续决定发布。
  return difficulty <= 3 ? [...base, 'blind_solve'] : base;
}

interface SlotOutcome {
  readonly record: QuestionRecord | null;
  readonly failure: FailureRecord | null;
  readonly duplicate: boolean;
  readonly citationLocated: boolean;
  readonly blind: { attempts: number; passes: number };
  readonly contrast: { attempts: number; passes: number };
  readonly distractor: { attempted: boolean; passed: boolean };
}

async function runSlot(
  client: QwenClient,
  slot: Slot,
  misconceptions: readonly Misconception[],
  options: SpikeOptions,
  language: MaterialLanguage,
  seenSimhashes: readonly bigint[],
  seenStemKeys: ReadonlySet<string>,
  counters: StructuredCounters,
): Promise<SlotOutcome> {
  const startedAt = Date.now();
  const costBefore = client.stats.spentCny;
  const slotId = `${slot.kp.kp.id}:${slot.type}:${slot.index}`;
  const promptVersion = GENERATE_QUESTION_PROMPT_VERSION;
  const seed = seedFromDigestHex(sha256(seedMaterial({
    materialId: options.materialId,
    slot: slotId,
    promptVersion,
  })));
  const idempotencyKey = sha256(
    idempotencyKeyMaterial({
      materialId: options.materialId,
      kpId: slot.kp.kp.id,
      slot: slotId,
      promptVersion,
      model: MODEL_FOR.generate,
    }),
  );

  const sourceText = slot.kp.chunks
    .map((chunk) => chunk.text)
    .join('\n\n')
    .slice(0, 4000);
  const misForPrompt = misconceptions.map((item, index) => ({
    index,
    statement: item.statement,
    correctContrast: item.correctContrast,
  }));

  let feedback: string | null = null;
  let prepared: PreparedQuestion | null = null;
  let located: ReturnType<typeof locateQuote> = null;
  let generationLatencyMs = 0;

  for (let attempt = 0; attempt < 2 && prepared === null; attempt += 1) {
    const baseMessages = buildGenerateQuestionMessages({
      language,
      type: slot.type,
      kpName: slot.kp.kp.name,
      kpSummary: slot.kp.kp.summary,
      misconceptions: misForPrompt,
      sourceText,
      targetDifficulty: slot.targetDifficulty,
    });
    const messages: LlmMessage[] =
      feedback === null
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'user',
              content: `上一次生成存在以下问题：${feedback}\n请重新生成一道完全符合要求的题。`,
            },
          ];

    try {
      const { data, completion } = await callStructured(client, generatedQuestionSchema, {
        model: MODEL_FOR.generate,
        messages,
        promptVersion,
        temperature: 0.6,
        seed,
        maxTokens: 3000,
      }, counters);

      const validation = validateGenerated(data, slot.type, language);
      if (!validation.ok) {
        feedback = validation.error;
        continue;
      }

      const quoteHit = locateQuote(slot.kp.chunks, validation.prepared.answerQuote);
      if (!quoteHit) {
        feedback = `answer_quote 未能在原文中逐字找到：「${validation.prepared.answerQuote.slice(0, 80)}」。请只复制原文中一段连续、完整的句子（8–120 字）：不要拼接多处、不要带页码/页眉/脚注标记、不要用省略号。`;
        continue;
      }

      prepared = validation.prepared;
      located = quoteHit;
      generationLatencyMs = completion.latencyMs;
    } catch (error) {
      if (error instanceof LlmBudgetError) {
        throw error;
      }
      feedback = error instanceof StructuredOutputError ? error.message : String(error);
    }
  }

  const costCny = Number((client.stats.spentCny - costBefore).toFixed(6));

  if (prepared === null || located === null) {
    return {
      record: null,
      failure: {
        slot: slotId,
        kpName: slot.kp.kp.name,
        stage: 'generation',
        message: feedback ?? '生成失败（未知原因）',
        costCny,
      },
      duplicate: false,
      citationLocated: false,
      blind: { attempts: 0, passes: 0 },
      contrast: { attempts: 0, passes: 0 },
      distractor: { attempted: false, passed: false },
    };
  }

  // 权威校验：domain 的 checkCitation 拿 normalized_text 切片与模型原始引用比对。
  // 定位成功只说明"原文里有这段"，这一步才回答"它是不是同一段"。
  const citationCheck = checkCitation({
    text: options.document.normalizedText,
    charStart: located.charStart,
    charEnd: located.charEnd,
    quote: prepared.answerQuote,
    language,
  });
  // 纯排版差异不算引用错误：sourceRefs 里存的是 located.quote（原文切片），
  // 模型多打/少打一个空格、或把行尾断字 de-\nvelopment 连成 development，
  // 都不改变"这句话在原文里"这一事实；非排版差异照常拒绝。
  const layoutOnly = (text: string): string =>
    text
      .replace(/(\p{L})-[ \t]+(\p{L})/gu, '$1$2')
      .replace(/\s+/g, '');
  const whitespaceOnly =
    !citationCheck.ok &&
    citationCheck.problem === 'mismatch' &&
    layoutOnly(citationCheck.expected) === layoutOnly(citationCheck.actual);

  if (!citationCheck.ok && !whitespaceOnly) {
    return {
      record: null,
      failure: {
        slot: slotId,
        kpName: slot.kp.kp.name,
        stage: 'citation',
        message: `引用校验失败（${citationCheck.problem}）：期望「${citationCheck.expected}」，实际「${citationCheck.actual}」`,
        costCny: Number((client.stats.spentCny - costBefore).toFixed(6)),
      },
      duplicate: false,
      citationLocated: false,
      blind: { attempts: 0, passes: 0 },
      contrast: { attempts: 0, passes: 0 },
      distractor: { attempted: false, passed: false },
    };
  }

  const optionIds = OPTION_IDS.slice(0, prepared.optionTexts.length);
  const answerIds = prepared.answerIndices.map((index) => optionIds[index] ?? 'A');
  const questionId = `${options.materialId}-q${slot.index}`;
  const stemSimhash = simhash64(`${prepared.stem}\n${prepared.optionTexts.join('\n')}`, language);
  const exactKey = stemKey(prepared.stem);

  if (seenStemKeys.has(exactKey) || isDuplicate(stemSimhash, seenSimhashes)) {
    return {
      record: null,
      failure: {
        slot: slotId,
        kpName: slot.kp.kp.name,
        stage: 'duplicate',
        message: seenStemKeys.has(exactKey)
          ? '题干规范化后与已有题目完全相同'
          : '题干与已有题目 simhash 汉明距离 ≤3',
        costCny,
      },
      duplicate: true,
      citationLocated: true,
      blind: { attempts: 0, passes: 0 },
      contrast: { attempts: 0, passes: 0 },
      distractor: { attempted: false, passed: false },
    };
  }

  const pageNo = pageForOffset(
    options.document.pages,
    located.charStart,
    located.chunk.pageStart,
  );

  const question: Question = {
    id: questionId,
    materialId: options.materialId,
    type: slot.type,
    stem: prepared.stem,
    options: prepared.optionTexts.map((text, index) => {
      const optionId = optionIds[index] ?? 'A';
      const isAnswer = answerIds.includes(optionId);
      const misconceptionIndex = isAnswer ? null : (prepared.options[index]?.misconception_index ?? null);
      return {
        id: optionId,
        text,
        misconceptionId:
          misconceptionIndex === null ? null : (misconceptions[misconceptionIndex]?.id ?? null),
      };
    }),
    answer: answerIds,
    explanation: prepared.explanation,
    difficultyEst: prepared.difficultyEst,
    primaryKpId: slot.kp.kp.id,
    kpIds: [slot.kp.kp.id],
    sourceRefs: [
      {
        chunkId: located.chunk.id,
        quote: located.quote,
        charStart: located.charStart,
        charEnd: located.charEnd,
        pageNo: pageNo ?? located.chunk.pageStart ?? 1,
        role: 'answer_basis',
      },
    ],
    status: 'verifying',
    version: 1,
  };

  const checks: QuestionCheck[] = [
    hardCheck('schema', true, 'zod 校验通过'),
    hardCheck('citation_exists', true, `${located.match} 命中，偏移 ${located.charStart}–${located.charEnd}`),
    hardCheck('answer_unique', true, `${slot.type} 答案 ${answerIds.join(',')}`),
    hardCheck('duplicate', true, `simhash ${simhashToHex(stemSimhash)} 无近似命中`),
  ];

  const verifyMessages = buildVerifyQuestionMessages({
    language,
    stem: question.stem,
    options: question.options.map((option) => ({ id: option.id, text: option.text })),
    answerLetters: answerIds,
    explanation: question.explanation,
    answerQuote: located.quote,
    sourceText: located.chunk.text,
    difficultyEst: question.difficultyEst,
  });

  let verify: { data: VerifyResponseOutput; completion: LlmCompletion } | null = null;
  try {
    verify = await callStructured(client, verifyResponseSchema, {
      model: MODEL_FOR.verify,
      messages: verifyMessages,
      promptVersion: VERIFY_QUESTION_PROMPT_VERSION,
      temperature: 0.2,
      maxTokens: 2500,
    }, counters);
  } catch (error) {
    if (error instanceof LlmBudgetError) {
      throw error;
    }
  }

  if (!verify) {
    return {
      record: null,
      failure: {
        slot: slotId,
        kpName: slot.kp.kp.name,
        stage: 'verify',
        message: '质检调用失败（fail-closed：不发布）',
        costCny: Number((client.stats.spentCny - costBefore).toFixed(6)),
      },
      duplicate: false,
      citationLocated: true,
      blind: { attempts: 0, passes: 0 },
      contrast: { attempts: 0, passes: 0 },
      distractor: { attempted: false, passed: false },
    };
  }

  const verifyData = verify.data;
  checks.push(
    hardCheck(
      'citation_supports',
      verifyData.citation_supports.passed,
      verifyData.citation_supports.detail,
    ),
  );

  const wrongIds: string[] = optionIds.filter((id) => !answerIds.includes(id));
  const challenged = new Set<string>();
  let distractorProblem: string | null = null;
  for (const entry of verifyData.distractors) {
    const letters = lettersIn(entry.option, optionIds);
    for (const letter of letters) {
      if (!wrongIds.includes(letter)) {
        continue;
      }
      challenged.add(letter);
      if (entry.could_be_correct) {
        distractorProblem = `选项 ${letter} 可能也成立：${entry.reason}`;
      }
    }
  }
  const missing = wrongIds.filter((id) => !challenged.has(id));
  if (missing.length > 0) {
    distractorProblem = `未质询错误选项 ${missing.join(',')}（fail-closed）`;
  }
  checks.push(hardCheck('distractor_challenge', distractorProblem === null, distractorProblem));

  for (const type of ['answer_leakage', 'faithfulness', 'difficulty_fit', 'explanation_quality'] as const) {
    const item = verifyData.soft[type];
    checks.push(softCheck(type, item.score, item.detail));
  }

  const blindRecords: BlindSolveRecord[] = [];
  let blindAttempts = 0;
  let blindPasses = 0;
  let contrastResult: { secondAnswerDefensible: boolean; detail: string } | null = null;
  let contrastAttempts = 0;
  let contrastPasses = 0;

  if (question.difficultyEst <= 3) {
    const variants: BlindSolveVariant[] = ['direct', 'reason_first'];
    for (const [variantIndex, variant] of variants.entries()) {
      const messages = buildBlindSolveMessages({
        language,
        stem: question.stem,
        options: question.options.map((option) => ({ id: option.id, text: option.text })),
        sourceText: located.chunk.text,
        variant,
      });

      try {
        const { data } = await callStructured(client, blindSolveSchema, {
          model: MODEL_FOR.blind,
          messages,
          promptVersion: BLIND_SOLVE_PROMPT_VERSION,
          temperature: 0.7,
          seed: (seed + variantIndex + 1) % 2 ** 32,
          maxTokens: 1500,
        }, counters);
        const letters = [
          ...new Set(
            data.answer_letters.flatMap((value) => lettersIn(value, optionIds)),
          ),
        ].sort();
        const correct = sameSet(letters, answerIds);
        blindAttempts += 1;
        if (correct) {
          blindPasses += 1;
        }
        blindRecords.push({ variant, answerLetters: letters, correct, reasoning: data.reasoning });
      } catch (error) {
        if (error instanceof LlmBudgetError) {
          throw error;
        }
        blindAttempts += 1;
        blindRecords.push({
          variant,
          answerLetters: [],
          correct: false,
          reasoning: `调用失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    checks.push(
      hardCheck(
        'blind_solve',
        blindPasses === 2,
        `盲解 ${blindPasses}/2：${blindRecords
          .map((record) => `${record.variant}→${record.answerLetters.join('') || '失败'}`)
          .join('；')}`,
      ),
    );
  } else {
    const messages = buildAnswerContrastMessages({
      language,
      stem: question.stem,
      options: question.options.map((option) => ({ id: option.id, text: option.text })),
      answerLetters: answerIds,
      sourceText: located.chunk.text,
    });

    try {
      const { data } = await callStructured(client, answerContrastSchema, {
        model: MODEL_FOR.contrast,
        messages,
        promptVersion: ANSWER_CONTRAST_PROMPT_VERSION,
        temperature: 0.2,
        maxTokens: 1500,
      }, counters);
      contrastAttempts += 1;
      contrastResult = {
        secondAnswerDefensible: data.second_answer_defensible,
        detail: data.second_answer_reason || data.derivation.slice(0, 200),
      };
      if (!data.second_answer_defensible) {
        contrastPasses += 1;
      }
    } catch (error) {
      if (error instanceof LlmBudgetError) {
        throw error;
      }
      contrastAttempts += 1;
      contrastResult = {
        secondAnswerDefensible: true,
        detail: `反证调用失败，按 fail-closed 处理：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 反证结果只进 verification（题目明细里作"参考意见"展示），不生成 hard check：
    // 同上，K3 D3 Major 1。
  }

  const applicable = applicableHardChecksFor(question.difficultyEst);
  const evaluated = evaluatePublish(question, checks, applicable);
  // 难度 4–5：无论反证结论如何都转人工，禁止自动发布（K3 D3 Major 1）。
  const decision: PublishDecision =
    question.difficultyEst >= 4
      ? {
          ...evaluated,
          canPublish: false,
          reasons: [...evaluated.reasons, 'high_difficulty_manual_review'],
        }
      : evaluated;
  const finalQuestion: Question = {
    ...question,
    status: decision.canPublish ? 'auto_passed' : 'needs_review',
  };

  return {
    record: {
      question: finalQuestion,
      checks,
      decision,
      applicableHardChecks: applicable,
      simhash: simhashToHex(stemSimhash),
      kpName: slot.kp.kp.name,
      generation: {
        idempotencyKey,
        model: MODEL_FOR.generate,
        promptVersion,
        seed,
        latencyMs: generationLatencyMs,
      },
      verification: {
        citationMatch: located.match,
        blindSolve: blindRecords,
        answerContrast: contrastResult,
      },
      costCny: Number((client.stats.spentCny - costBefore).toFixed(6)),
      latencyMs: Date.now() - startedAt,
    },
    failure: null,
    duplicate: false,
    citationLocated: true,
    blind: { attempts: blindAttempts, passes: blindPasses },
    contrast: { attempts: contrastAttempts, passes: contrastPasses },
    distractor: { attempted: true, passed: distractorProblem === null },
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

export async function runSpike(
  client: QwenClient,
  options: SpikeOptions,
  language: MaterialLanguage,
  targetKps: number,
): Promise<SpikeResult> {
  const warnings: string[] = [];
  const failures: FailureRecord[] = [];
  const counters = createStructuredCounters();
  const kpCounters = { blockRepairs: 0 };

  const kps = await extractKnowledgePoints(
    client,
    options,
    language,
    targetKps,
    warnings,
    failures,
    counters,
    kpCounters,
  );
  if (kps.length === 0) {
    throw new Error('没有抽到任何可用知识点，spike 终止');
  }
  if (kps.length < targetKps) {
    warnings.push(
      `知识点数量 ${kps.length} 低于目标 ${targetKps}（材料过短或抽取不足；蓝图公式按页数推导）`,
    );
  }

  const requested = options.itemLimit ?? targetQuestionCount(options.document.pages.length);
  const slots = planSlots(kps, requested, language);

  // 只为真正会分配题目的 KP 花易错点辨析的钱
  const usedKpIds = new Set(slots.map((slot) => slot.kp.kp.id));
  const usedKps = kps.filter((entry) => usedKpIds.has(entry.kp.id));
  const misconceptionsByKp = await extractMisconceptions(
    client,
    usedKps,
    language,
    warnings,
    counters,
  );

  const questions: QuestionRecord[] = [];
  const seen: bigint[] = [];
  const seenStemKeys = new Set<string>();
  let duplicateHits = 0;
  let citationLocated = 0;
  let blindAttempts = 0;
  let blindPasses = 0;
  let distractorAttempts = 0;
  let distractorPasses = 0;
  let reallocationRetries = 0;
  let reallocationSuccess = 0;

  for (const slot of slots) {
    try {
      let outcome = await runSlot(
        client,
        slot,
        misconceptionsByKp.get(slot.kp.kp.id) ?? [],
        options,
        language,
        seen,
        seenStemKeys,
        counters,
      );

      // 题型补位（K3 D3 Major 3）：生成失败（含多选答案数非法）时，
      // 同一考点先换另一种题型重试一次，仍失败再降级单选；补位题不改变题位号。
      if (outcome.failure && outcome.failure.stage === 'generation') {
        const alternativeTypes: QuestionType[] =
          slot.type === 'single_choice'
            ? ['multiple_choice', 'true_false']
            : [slot.type === 'multiple_choice' ? 'true_false' : 'multiple_choice', 'single_choice'];
        const reason = outcome.failure.message.slice(0, 60);
        for (const alternative of alternativeTypes) {
          reallocationRetries += 1;
          const retried = await runSlot(
            client,
            { ...slot, type: alternative },
            misconceptionsByKp.get(slot.kp.kp.id) ?? [],
            options,
            language,
            seen,
            seenStemKeys,
            counters,
          );
          if (retried.record) {
            reallocationSuccess += 1;
            warnings.push(
              `题位 ${slot.index}（${slot.type}）生成失败，已用同考点${TYPE_LABEL_FOR_WARNING[alternative]}补位（原因：${reason}）`,
            );
            outcome = retried;
            break;
          }
          outcome = retried;
        }
        if (!outcome.record) {
          warnings.push(`题位 ${slot.index}（${slot.type}）生成失败，换题型补位均失败`);
        }
      }

      if (outcome.record) {
        questions.push(outcome.record);
        seen.push(BigInt(`0x${outcome.record.simhash}`));
        seenStemKeys.add(stemKey(outcome.record.question.stem));
      }
      if (outcome.failure) {
        failures.push(outcome.failure);
      }
      if (outcome.duplicate) {
        duplicateHits += 1;
      }
      if (outcome.citationLocated) {
        citationLocated += 1;
      }
      blindAttempts += outcome.blind.attempts;
      blindPasses += outcome.blind.passes;
      if (outcome.distractor.attempted) {
        distractorAttempts += 1;
        if (outcome.distractor.passed) {
          distractorPasses += 1;
        }
      }
    } catch (error) {
      if (error instanceof LlmBudgetError) {
        warnings.push(error.message);
        break;
      }
      failures.push({
        slot: `${slot.kp.kp.id}:${slot.index}`,
        kpName: slot.kp.kp.name,
        stage: 'generation',
        message: error instanceof Error ? error.message : String(error),
        costCny: 0,
      });
    }
  }

  const autoPassed = questions.filter((record) => record.decision.canPublish);
  const highDifficulty = autoPassed.filter((record) => record.question.difficultyEst >= 4);
  // 反证门槛按"最终题"口径统计（K3 D3 Major 1③）：只数最终进入 questions 的难度 ≥4 题，
  // 生成阶段失败/被判重复的尝试不计入分母，避免把 attempt 级数字当门槛结果。
  const contrastQuestions = questions.filter(
    (record) => record.question.difficultyEst >= 4 && record.verification.answerContrast !== null,
  );
  const contrastPasses = contrastQuestions.filter(
    (record) => record.verification.answerContrast?.secondAnswerDefensible === false,
  ).length;
  const contrastAttempts = contrastQuestions.length;
  const softScores = questions.map((record) => record.decision.softScore);
  const latencies = questions.map((record) => record.latencyMs);
  const stats = client.stats;

  return {
    kps,
    misconceptions: [...misconceptionsByKp.values()].flat(),
    questions,
    failures,
    warnings,
    stats: {
      requestedItems: requested,
      plannedSlots: slots.length,
      generated: questions.length,
      autoPassed: autoPassed.length,
      needsReview: questions.length - autoPassed.length,
      failed: failures.filter((failure) => failure.stage !== 'kp_extract').length,
      duplicateHits,
      citationLocated,
      blindSolveAttempts: blindAttempts,
      blindSolvePasses: blindPasses,
      contrastAttempts,
      contrastPasses,
      distractorAttempts,
      distractorPasses,
      schemaFirstPassRate:
        counters.calls === 0 ? null : Number((counters.firstPass / counters.calls).toFixed(3)),
      schemaAfterRepairRate:
        counters.firstPass + counters.repairedPass + counters.failures === 0
          ? null
          : Number(
              (
                (counters.firstPass + counters.repairedPass) /
                (counters.firstPass + counters.repairedPass + counters.failures)
              ).toFixed(3),
            ),
      repairCalls: counters.repairs,
      kpBlockRepairCount: kpCounters.blockRepairs,
      reallocationRetries,
      reallocationSuccess,
      highDifficultyShare:
        autoPassed.length === 0 ? null : Number((highDifficulty.length / autoPassed.length).toFixed(3)),
      highDifficultyGeneratedShare:
        questions.length === 0
          ? null
          : Number(
              (
                questions.filter((record) => record.question.difficultyEst >= 4).length /
                questions.length
              ).toFixed(3),
            ),
      softScoreAvg:
        softScores.length === 0
          ? null
          : Number((softScores.reduce((sum, value) => sum + value, 0) / softScores.length).toFixed(3)),
      kpTarget: targetKps,
      kpExtracted: kps.length,
      kpUsed: usedKps.length,
      costCny: Number(stats.spentCny.toFixed(4)),
      costPerQuestionCny:
        questions.length === 0 ? null : Number((stats.spentCny / questions.length).toFixed(4)),
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheHits: stats.cacheHits,
      llmCalls: stats.calls,
      avgLatencyMs: latencies.length === 0 ? 0 : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p95LatencyMs: Math.round(percentile(latencies, 0.95)),
      hardErrorRate: null,
    },
  };
}
