import type { Material } from '@qgen/domain';

import type { JobRepository, MaterialRepository, ProcessingJob } from '../ports/repositories.ts';

export interface MaterialProgress {
  readonly material: Material;
  readonly job: ProcessingJob | null;
}

export class GetMaterialProgress {
  constructor(
    private readonly deps: {
      readonly materials: MaterialRepository;
      readonly jobs: JobRepository;
    },
  ) {}

  async execute(materialId: string): Promise<MaterialProgress | null> {
    const material = await this.deps.materials.findById(materialId);
    if (material === null) {
      return null;
    }

    return {
      material,
      job: await this.deps.jobs.findLatestByMaterial(materialId),
    };
  }
}
