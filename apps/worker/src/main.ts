import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { loadConfig } from '@qgen/config';
import type { ProcessingJob } from '@qgen/application';
import {
  createSqliteDb,
  SqliteJobRepository,
  SqliteMaterialRepository,
} from '@qgen/infrastructure';

/**
 * M0 的 worker：独立进程、SQLite 队列、全局串行 FIFO。
 * D1 阶段各 stage 是空实现，只推进进度；真正的解析/出题在 D3 接入。
 */

const STAGE_SEQUENCE = ['parse', 'normalize', 'chunk'] as const;
const IDLE_POLL_MS = 1000;
const STUB_STAGE_MS = 300;
/** 计划第十五节「D2 重试设计」：attempt < 2 自动回队，第 2 次失败才标 failed */
const MAX_ATTEMPTS = 2;

const config = loadConfig();
const { sqlite, db } = createSqliteDb(resolve(config.dataDir, 'qgen.db'));

const materials = new SqliteMaterialRepository(db);
const jobs = new SqliteJobRepository(db);

let running = true;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function stop(signal: string): void {
  console.log(`[worker] ${signal} received, finishing current stage then exiting`);
  running = false;
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

async function runStage(job: ProcessingJob): Promise<void> {
  const index = STAGE_SEQUENCE.indexOf(job.stage as (typeof STAGE_SEQUENCE)[number]);
  if (index === -1) {
    throw new Error(`未知阶段: ${job.stage}`);
  }

  // 关停请求不打断阶段：中途 throw 会让 job 落成 failed，而 failed 既不在僵尸清理范围内，
  // 又被 (materialId, stage) 唯一索引堵住重新入队——材料会永久卡死。阶段跑完后由
  // while (running) 自然退出（K3 第四轮 Blocker 1）。
  for (const progress of [15, 45, 80]) {
    await sleep(STUB_STAGE_MS);
    await jobs.updateProgress(job.id, progress, new Date());
  }

  await jobs.complete(job.id, new Date());

  const nextStage = STAGE_SEQUENCE[index + 1];
  if (nextStage) {
    await jobs.enqueue({
      id: randomUUID(),
      materialId: job.materialId,
      stage: nextStage,
      createdAt: new Date(),
    });
  } else {
    await materials.updateStatus(job.materialId, 'ready', new Date());
  }
}

const zombies = await jobs.resetZombies(new Date());
console.log(`[worker] 重置 ${zombies} 条僵尸任务（上次进程遗留的 running）`);

while (running) {
  const job = await jobs.claimNext(new Date());
  if (!job) {
    await sleep(IDLE_POLL_MS);
    continue;
  }

  console.log(`[worker] ${job.materialId} ${job.stage} 开始`);
  await materials.updateStatus(job.materialId, 'processing', new Date());

  try {
    await runStage(job);
    console.log(`[worker] ${job.materialId} ${job.stage} 完成`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempt < MAX_ATTEMPTS) {
      // 失败不阻塞：回队后让位下一任务，重试预算按累计 attempt 判定
      console.warn(
        `[worker] ${job.materialId} ${job.stage} 第 ${job.attempt} 次失败，重新入队: ${message}`,
      );
      await jobs.requeue(job.id, new Date());
    } else {
      console.error(`[worker] ${job.materialId} ${job.stage} 失败（已用满 ${MAX_ATTEMPTS} 次尝试）: ${message}`);
      await jobs.fail(job.id, message, new Date());
      await materials.updateStatus(job.materialId, 'failed', new Date());
    }
  }
}

sqlite.close();
console.log('[worker] 已退出');
