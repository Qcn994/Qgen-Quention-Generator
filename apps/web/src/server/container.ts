import { resolve } from 'node:path';

import { GetMaterialProgress, IngestMaterial, RetryMaterial } from '@qgen/application';
import { loadConfig } from '@qgen/config';
import {
  createSqliteDb,
  SqliteJobRepository,
  SqliteMaterialRepository,
} from '@qgen/infrastructure';

/**
 * 组合根：唯一允许把 infrastructure 接到 application 的地方。
 * Next 开发模式会反复热更新，这里用单例避免重复打开 SQLite。
 */
export interface AppContainer {
  readonly materials: SqliteMaterialRepository;
  readonly jobs: SqliteJobRepository;
  readonly ingestMaterial: IngestMaterial;
  readonly getMaterialProgress: GetMaterialProgress;
  readonly retryMaterial: RetryMaterial;
}

let cached: AppContainer | null = null;

export function getContainer(): AppContainer {
  if (cached) {
    return cached;
  }

  const config = loadConfig();
  const { db } = createSqliteDb(resolve(config.dataDir, 'qgen.db'));

  const materials = new SqliteMaterialRepository(db);
  const jobs = new SqliteJobRepository(db);
  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => crypto.randomUUID() };

  cached = {
    materials,
    jobs,
    ingestMaterial: new IngestMaterial({ materials, jobs, clock, ids }),
    getMaterialProgress: new GetMaterialProgress({ materials, jobs }),
    retryMaterial: new RetryMaterial({ materials, jobs, clock }),
  };

  return cached;
}
