import type { Material, MaterialStatus } from '@qgen/domain';

export interface MaterialRepository {
  create(material: Material): Promise<void>;
  findById(id: string): Promise<Material | null>;
  list(limit: number): Promise<Material[]>;
  updateStatus(id: string, status: MaterialStatus, updatedAt: Date): Promise<void>;
}

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ProcessingJob {
  readonly id: string;
  readonly materialId: string;
  readonly stage: string;
  readonly status: JobStatus;
  readonly progress: number;
  readonly attempt: number;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewJob {
  readonly id: string;
  readonly materialId: string;
  readonly stage: string;
  readonly createdAt: Date;
}

/**
 * M0 的队列就是这张表。pg-boss 进来时，实现换掉，用例不动。
 */
export interface JobRepository {
  enqueue(job: NewJob): Promise<void>;
  /** FIFO 取一条 pending 并原子置为 running；没有任务返回 null */
  claimNext(now: Date): Promise<ProcessingJob | null>;
  updateProgress(id: string, progress: number, now: Date): Promise<void>;
  complete(id: string, now: Date): Promise<void>;
  fail(id: string, error: string, now: Date): Promise<void>;
  /**
   * 把一条失败（或运行中失败）的任务放回队列：status → pending、progress → 0、error → null。
   * attempt 不清零——它是累计尝试次数，重试预算由调用方按 attempt 判定。
   * 不放宽 (materialId, stage) 唯一索引：重试是 UPDATE 原行，不是插入新任务（计划第十五节）。
   */
  requeue(id: string, now: Date): Promise<boolean>;
  /** 启动时把上次进程遗留的 running 重置为 pending，返回重置条数 */
  resetZombies(now: Date): Promise<number>;
  findLatestByMaterial(materialId: string): Promise<ProcessingJob | null>;
}
