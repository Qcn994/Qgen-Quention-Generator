import { createMaterial, type Material, type MaterialStatus } from '@qgen/domain';
import { describe, expect, it } from 'vitest';

import type {
  JobRepository,
  MaterialRepository,
  NewJob,
  ProcessingJob,
} from '../ports/repositories.ts';
import { RetryMaterial } from './retry-material.ts';

const NOW = new Date('2026-10-25T00:00:00.000Z');

class FakeMaterials implements MaterialRepository {
  constructor(private readonly store: Map<string, Material>) {}

  async create(material: Material): Promise<void> {
    this.store.set(material.id, material);
  }

  async findById(id: string): Promise<Material | null> {
    return this.store.get(id) ?? null;
  }

  async list(limit: number): Promise<Material[]> {
    return [...this.store.values()].slice(0, limit);
  }

  async updateStatus(id: string, status: MaterialStatus, updatedAt: Date): Promise<void> {
    const material = this.store.get(id);
    if (material) {
      this.store.set(id, { ...material, status, updatedAt });
    }
  }
}

class FakeJobs implements JobRepository {
  constructor(readonly jobs: ProcessingJob[]) {}

  async enqueue(job: NewJob): Promise<void> {
    this.jobs.push({
      id: job.id,
      materialId: job.materialId,
      stage: job.stage,
      status: 'pending',
      progress: 0,
      attempt: 0,
      error: null,
      createdAt: job.createdAt,
      updatedAt: job.createdAt,
    });
  }

  async claimNext(): Promise<ProcessingJob | null> {
    return null;
  }

  async updateProgress(): Promise<void> {}

  async complete(): Promise<void> {}

  async fail(id: string, error: string, now: Date): Promise<void> {
    this.patch(id, { status: 'failed', error, updatedAt: now });
  }

  async requeue(id: string, now: Date): Promise<boolean> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || (job.status !== 'failed' && job.status !== 'running')) {
      return false;
    }
    this.patch(id, { status: 'pending', progress: 0, error: null, updatedAt: now });
    return true;
  }

  async resetZombies(): Promise<number> {
    return 0;
  }

  async findLatestByMaterial(materialId: string): Promise<ProcessingJob | null> {
    const matches = this.jobs.filter((job) => job.materialId === materialId);
    return matches[matches.length - 1] ?? null;
  }

  private patch(id: string, partial: Partial<ProcessingJob>): void {
    const index = this.jobs.findIndex((job) => job.id === id);
    const existing = this.jobs[index];
    if (index >= 0 && existing) {
      this.jobs[index] = { ...existing, ...partial };
    }
  }
}

function setup(job: Partial<ProcessingJob> | null) {
  const material = createMaterial({
    id: 'm1',
    fileName: 'demo.txt',
    sourceType: 'text/plain',
    now: NOW,
  });
  const base: ProcessingJob = {
    id: 'j1',
    materialId: 'm1',
    stage: 'normalize',
    status: 'failed',
    progress: 40,
    attempt: 2,
    error: '模拟失败',
    createdAt: NOW,
    updatedAt: NOW,
    ...job,
  };

  const materials = new FakeMaterials(new Map([[material.id, material]]));
  const jobs = new FakeJobs(job === null ? [] : [base]);
  const useCase = new RetryMaterial({ materials, jobs, clock: { now: () => NOW } });

  return { useCase, materials, jobs };
}

describe('手工重试失败阶段', () => {
  it('失败阶段回队，材料回到 processing，返回阶段名', async () => {
    const { useCase, jobs } = setup({});
    const result = await useCase.execute('m1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stage).toBe('normalize');
      expect(result.material.status).toBe('processing');
    }

    const job = jobs.jobs[0];
    expect(job?.status).toBe('pending');
    expect(job?.progress).toBe(0);
    expect(job?.error).toBeNull();
    // attempt 是累计尝试次数，重试后不清零
    expect(job?.attempt).toBe(2);
  });

  it('材料不存在返回 not_found', async () => {
    const { useCase } = setup({});
    const result = await useCase.execute('nope');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('最新阶段不是 failed 时拒绝，且不动任务状态', async () => {
    const { useCase, jobs } = setup({ status: 'done', progress: 100, error: null });
    const result = await useCase.execute('m1');

    expect(result).toEqual({ ok: false, reason: 'no_failed_stage' });
    expect(jobs.jobs[0]?.status).toBe('done');
  });

  it('没有任何任务时拒绝', async () => {
    const { useCase } = setup(null);
    const result = await useCase.execute('m1');
    expect(result).toEqual({ ok: false, reason: 'no_failed_stage' });
  });
});
