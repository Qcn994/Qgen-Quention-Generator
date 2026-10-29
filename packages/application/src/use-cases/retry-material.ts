import type { Material } from '@qgen/domain';

import type { Clock } from '../ports/clock.ts';
import type { JobRepository, MaterialRepository } from '../ports/repositories.ts';

export type RetryMaterialResult =
  | { readonly ok: true; readonly material: Material; readonly stage: string }
  | { readonly ok: false; readonly reason: 'not_found' | 'no_failed_stage' };

/**
 * 手工重试：只重试失败的阶段（计划 API POST /api/v1/materials/:id/retry）。
 * 实现方式是 UPDATE 原 job，不新建任务——唯一索引就是「每材料每阶段一条记录」的不变量。
 */
export class RetryMaterial {
  constructor(
    private readonly deps: {
      readonly materials: MaterialRepository;
      readonly jobs: JobRepository;
      readonly clock: Clock;
    },
  ) {}

  async execute(materialId: string): Promise<RetryMaterialResult> {
    const material = await this.deps.materials.findById(materialId);
    if (material === null) {
      return { ok: false, reason: 'not_found' };
    }

    const job = await this.deps.jobs.findLatestByMaterial(materialId);
    if (job === null || job.status !== 'failed') {
      return { ok: false, reason: 'no_failed_stage' };
    }

    const now = this.deps.clock.now();
    const requeued = await this.deps.jobs.requeue(job.id, now);
    if (!requeued) {
      return { ok: false, reason: 'no_failed_stage' };
    }

    await this.deps.materials.updateStatus(materialId, 'processing', now);

    return {
      ok: true,
      material: { ...material, status: 'processing', updatedAt: now },
      stage: job.stage,
    };
  }
}
