import { createMaterial, type Material } from '@qgen/domain';

import type { Clock } from '../ports/clock.ts';
import type { IdGenerator } from '../ports/id-generator.ts';
import type { JobRepository, MaterialRepository } from '../ports/repositories.ts';

export interface IngestMaterialInput {
  readonly fileName: string;
  readonly sourceType: string;
}

export interface IngestMaterialDeps {
  readonly materials: MaterialRepository;
  readonly jobs: JobRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * 上传只做三件事：落材料行、入队第一个阶段、返回 id。
 * 真正耗时的解析不出现在请求线程里。
 */
export class IngestMaterial {
  constructor(private readonly deps: IngestMaterialDeps) {}

  async execute(input: IngestMaterialInput): Promise<Material> {
    const now = this.deps.clock.now();
    const material = createMaterial({
      id: this.deps.ids.next(),
      fileName: input.fileName,
      sourceType: input.sourceType,
      now,
    });

    await this.deps.materials.create(material);
    await this.deps.jobs.enqueue({
      id: this.deps.ids.next(),
      materialId: material.id,
      stage: 'parse',
      createdAt: now,
    });

    return material;
  }
}
