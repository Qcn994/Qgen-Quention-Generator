import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

/**
 * 各 app 的 cwd 不同（apps/web、apps/worker、packages/infrastructure），
 * 相对 DATA_DIR 必须锚定到仓库根，否则会各写一个库。
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return start;
}

export const REPO_ROOT = findRepoRoot(process.cwd());

/**
 * 应用层只认 tier，不认模型名。
 * 换供应商 = 改这一张表，不动业务代码。
 */
export const MODEL_ROUTES = {
  cheap: { primary: 'deepseek-chat', fallback: 'qwen-plus' },
  strong: { primary: 'qwen-max', fallback: 'deepseek-chat' },
  verify: { primary: 'doubao-pro', fallback: 'glm-4-plus' },
} as const;

export type ModelTier = keyof typeof MODEL_ROUTES;

const envSchema = z.object({
  DATA_DIR: z.string().default('./data'),
  LLM_BUDGET_PER_MATERIAL_CNY: z.coerce.number().positive().default(15),
  DASHSCOPE_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  ARK_API_KEY: z.string().optional(),
  ZHIPU_API_KEY: z.string().optional(),
});

export type AppConfig = {
  readonly dataDir: string;
  readonly llmBudgetPerMaterialCny: number;
  readonly apiKeys: {
    readonly dashscope?: string;
    readonly deepseek?: string;
    readonly ark?: string;
    readonly zhipu?: string;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    dataDir: isAbsolute(parsed.DATA_DIR)
      ? parsed.DATA_DIR
      : resolve(REPO_ROOT, parsed.DATA_DIR),
    llmBudgetPerMaterialCny: parsed.LLM_BUDGET_PER_MATERIAL_CNY,
    apiKeys: {
      ...(parsed.DASHSCOPE_API_KEY ? { dashscope: parsed.DASHSCOPE_API_KEY } : {}),
      ...(parsed.DEEPSEEK_API_KEY ? { deepseek: parsed.DEEPSEEK_API_KEY } : {}),
      ...(parsed.ARK_API_KEY ? { ark: parsed.ARK_API_KEY } : {}),
      ...(parsed.ZHIPU_API_KEY ? { zhipu: parsed.ZHIPU_API_KEY } : {}),
    },
  };
}
