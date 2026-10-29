/**
 * M0 的 LLM 客户端：DashScope OpenAI 兼容接口，单厂商（Qwen）。
 * 职责只到"发一次 JSON 调用、失败重试、记账、命中精确缓存"，
 * 质检/出题的业务判断都在 evals 的流水线里，不塞进客户端。
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Db } from '../db/client.ts';
import { llmCache } from '../db/schema.ts';

export type QwenModel = 'qwen-plus' | 'qwen-max';

export const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/** 元 / 百万 token。M0 只用于预算护栏，实际以账单为准。 */
export const MODEL_PRICES: Readonly<Record<QwenModel, { readonly input: number; readonly output: number }>> =
  {
    'qwen-plus': { input: 0.8, output: 2 },
    'qwen-max': { input: 2.4, output: 9.6 },
  };

export interface LlmMessage {
  /** assistant 用于把上一次的非法输出回灌给修复调用 */
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface CompleteInput {
  readonly model: QwenModel;
  readonly messages: readonly LlmMessage[];
  readonly promptVersion: string;
  readonly temperature?: number;
  readonly seed?: number;
  readonly maxTokens?: number;
  readonly json?: boolean;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costCny: number;
}

export interface LlmCompletion {
  readonly text: string;
  readonly model: QwenModel;
  readonly usage: LlmUsage;
  readonly cached: boolean;
  readonly latencyMs: number;
}

export class LlmConfigError extends Error {}
export class LlmBudgetError extends Error {}
export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'LlmRequestError';
  }
}
export class LlmJsonError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'LlmJsonError';
  }
}

export interface LlmCacheStore {
  get(key: string): { response: string; inputTokens: number; outputTokens: number } | null;
  set(
    key: string,
    value: { model: string; response: string; inputTokens: number; outputTokens: number },
    now: Date,
  ): void;
}

/** 精确缓存：key = sha256(model|prompt_version|temp|messages)，重跑近乎免费 */
export class SqliteLlmCache implements LlmCacheStore {
  constructor(private readonly db: Db) {}

  get(key: string): { response: string; inputTokens: number; outputTokens: number } | null {
    const row = this.db.select().from(llmCache).where(eq(llmCache.key, key)).get();
    if (!row) {
      return null;
    }
    return { response: row.response, inputTokens: row.inputTokens, outputTokens: row.outputTokens };
  }

  set(
    key: string,
    value: { model: string; response: string; inputTokens: number; outputTokens: number },
    now: Date,
  ): void {
    this.db
      .insert(llmCache)
      .values({
        key,
        model: value.model,
        response: value.response,
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}

function cacheKey(input: CompleteInput): string {
  const material = [
    input.model,
    input.promptVersion,
    String(input.temperature ?? 0),
    JSON.stringify(input.messages),
  ].join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

function costOf(model: QwenModel, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICES[model];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

const RETRY_DELAYS_MS = [1_000, 4_000, 12_000] as const;
const REQUEST_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
  readonly error?: { readonly message?: string };
}

export interface QwenClientOptions {
  readonly apiKey: string | undefined;
  readonly cache?: LlmCacheStore;
  /** 本次运行的硬预算（元）。达到后 complete() 直接抛错 */
  readonly budgetCny?: number;
}

export class QwenClient {
  private spentCny = 0;
  private calls = 0;
  private cacheHits = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(private readonly options: QwenClientOptions) {}

  get stats(): {
    spentCny: number;
    calls: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
  } {
    return {
      spentCny: this.spentCny,
      calls: this.calls,
      cacheHits: this.cacheHits,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }

  async complete(input: CompleteInput): Promise<LlmCompletion> {
    if (!this.options.apiKey) {
      throw new LlmConfigError('缺少 DASHSCOPE_API_KEY：设置环境变量后再跑 LLM 阶段');
    }
    if (this.options.budgetCny !== undefined && this.spentCny >= this.options.budgetCny) {
      throw new LlmBudgetError(
        `预算已用尽（¥${this.spentCny.toFixed(2)} / ¥${this.options.budgetCny}），停止继续调用`,
      );
    }

    const key = cacheKey(input);
    const cached = this.options.cache?.get(key);
    if (cached) {
      this.cacheHits += 1;
      return {
        text: cached.response,
        model: input.model,
        usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens, costCny: 0 },
        cached: true,
        latencyMs: 0,
      };
    }

    const startedAt = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await this.request(input);
        const costCny = costOf(input.model, response.inputTokens, response.outputTokens);
        this.spentCny += costCny;
        this.calls += 1;
        this.inputTokens += response.inputTokens;
        this.outputTokens += response.outputTokens;

        this.options.cache?.set(
          key,
          {
            model: input.model,
            response: response.text,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
          },
          new Date(),
        );

        return {
          text: response.text,
          model: input.model,
          usage: { inputTokens: response.inputTokens, outputTokens: response.outputTokens, costCny },
          cached: false,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable =
          error instanceof LlmRequestError &&
          (error.status === null || error.status === 429 || error.status >= 500);
        if (!retryable || attempt === RETRY_DELAYS_MS.length) {
          throw lastError;
        }
        const delay = RETRY_DELAYS_MS[attempt] ?? 12_000;
        await sleep(delay + Math.floor(Math.random() * 300));
      }
    }

    throw lastError ?? new Error('LLM 调用失败');
  }

  async completeJson<T>(input: CompleteInput): Promise<{ data: T; completion: LlmCompletion }> {
    const completion = await this.complete({ ...input, json: true });
    try {
      return { data: JSON.parse(completion.text) as T, completion };
    } catch (error) {
      throw new LlmJsonError(
        `模型返回的不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`,
        completion.text,
      );
    }
  }

  private async request(
    input: CompleteInput,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 4096,
    };
    if (input.json === true) {
      body.response_format = { type: 'json_object' };
    }
    if (input.seed !== undefined) {
      // DashScope 只接受 32 位有符号整数范围内的 seed；领域层派生的是 uint32，这里收口。
      // 取模不改变"同输入同 seed"的确定性，只改变具体数值。
      body.seed = Math.abs(Math.trunc(input.seed)) % 2_147_483_647;
    }

    let response: Response;
    try {
      response = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new LlmRequestError(
        `网络请求失败: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new LlmRequestError(
        `HTTP ${response.status}: ${detail.slice(0, 500)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new LlmRequestError(
        `响应缺少 content${payload.error?.message ? `: ${payload.error.message}` : ''}`,
        null,
      );
    }

    return {
      text,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    };
  }
}
