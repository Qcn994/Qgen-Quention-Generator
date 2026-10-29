import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { JobRepository, NewJob, ProcessingJob } from '@qgen/application';

import type { Db } from '../client.ts';
import { processingJobs } from '../schema.ts';

type JobRow = typeof processingJobs.$inferSelect;

function toJob(row: JobRow): ProcessingJob {
  return {
    id: row.id,
    materialId: row.materialId,
    stage: row.stage,
    status: row.status,
    progress: row.progress,
    attempt: row.attempt,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: Db) {}

  async enqueue(job: NewJob): Promise<void> {
    this.db
      .insert(processingJobs)
      .values({
        id: job.id,
        materialId: job.materialId,
        stage: job.stage,
        status: 'pending',
        progress: 0,
        attempt: 0,
        createdAt: job.createdAt,
        updatedAt: job.createdAt,
      })
      .onConflictDoNothing()
      .run();
  }

  async claimNext(now: Date): Promise<ProcessingJob | null> {
    const next = this.db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.status, 'pending'))
      .orderBy(asc(processingJobs.createdAt), asc(processingJobs.id))
      .limit(1)
      .get();

    if (!next) {
      return null;
    }

    // 条件 update（where status = 'pending'）本身就是原子认领：两个进程 select 到同一行时，
    // 后到的 update 匹配 0 行、返回 null，不会双领。抢输时直接返回 null 由调用方重试（M0 单 worker 无感）。
    const updated = this.db
      .update(processingJobs)
      .set({ status: 'running', attempt: next.attempt + 1, updatedAt: now })
      .where(and(eq(processingJobs.id, next.id), eq(processingJobs.status, 'pending')))
      .returning()
      .get();

    return updated ? toJob(updated) : null;
  }

  async updateProgress(id: string, progress: number, now: Date): Promise<void> {
    this.db
      .update(processingJobs)
      .set({ progress: Math.max(0, Math.min(100, progress)), updatedAt: now })
      .where(eq(processingJobs.id, id))
      .run();
  }

  async complete(id: string, now: Date): Promise<void> {
    this.db
      .update(processingJobs)
      .set({ status: 'done', progress: 100, updatedAt: now })
      .where(eq(processingJobs.id, id))
      .run();
  }

  async fail(id: string, error: string, now: Date): Promise<void> {
    this.db
      .update(processingJobs)
      .set({ status: 'failed', error, updatedAt: now })
      .where(eq(processingJobs.id, id))
      .run();
  }

  async requeue(id: string, now: Date): Promise<boolean> {
    const result = this.db
      .update(processingJobs)
      .set({ status: 'pending', progress: 0, error: null, updatedAt: now })
      .where(and(eq(processingJobs.id, id), inArray(processingJobs.status, ['failed', 'running'])))
      .run();

    return result.changes > 0;
  }

  async resetZombies(now: Date): Promise<number> {
    const result = this.db
      .update(processingJobs)
      .set({ status: 'pending', updatedAt: now })
      .where(eq(processingJobs.status, 'running'))
      .run();

    return result.changes;
  }

  async findLatestByMaterial(materialId: string): Promise<ProcessingJob | null> {
    const row = this.db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.materialId, materialId))
      .orderBy(desc(processingJobs.updatedAt))
      .limit(1)
      .get();

    return row ? toJob(row) : null;
  }
}
