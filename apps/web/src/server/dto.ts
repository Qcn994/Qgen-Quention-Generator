import type { MaterialProgress } from '@qgen/application';
import type { MaterialDto, MaterialList, ProgressResponse } from '@qgen/contracts';
import { materialListSchema, progressResponseSchema } from '@qgen/contracts';
import type { Material } from '@qgen/domain';

/**
 * 交付层的 DTO 映射：领域对象 → 线上 JSON 形状。
 * 用 contracts 的 zod schema 校验后再返回，契约漂移会在接口处暴露，而不是等前端读到 undefined。
 */
export function toMaterialDto(material: Material): MaterialDto {
  return {
    id: material.id,
    fileName: material.fileName,
    sourceType: material.sourceType,
    status: material.status,
    pageCount: material.pageCount,
    charCount: material.charCount,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  };
}

export function toMaterialList(materials: readonly Material[]): MaterialList {
  return materialListSchema.parse({ items: materials.map(toMaterialDto) });
}

export function toProgressResponse(progress: MaterialProgress): ProgressResponse {
  return progressResponseSchema.parse({
    material: toMaterialDto(progress.material),
    job: progress.job
      ? {
          stage: progress.job.stage,
          status: progress.job.status,
          progress: progress.job.progress,
          error: progress.job.error,
        }
      : null,
  });
}
