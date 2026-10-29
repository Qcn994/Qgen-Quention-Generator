import { JOB_STATUSES } from '@qgen/application';
import { MATERIAL_STATUSES, QUESTION_TYPES } from '@qgen/domain';
import { z } from 'zod';

/**
 * 前后端共享的 DTO。枚举一律从 domain / application 派生，不在 contracts 里重新手写一份，
 * 否则三处枚举会各自漂移（K3 第四轮 Nit 1）。
 */

export const materialStatusSchema = z.enum(MATERIAL_STATUSES);
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const questionTypeSchema = z.enum(QUESTION_TYPES);

export const materialSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  sourceType: z.string(),
  status: materialStatusSchema,
  pageCount: z.number().int().nullable(),
  charCount: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const materialListSchema = z.object({
  items: z.array(materialSchema),
});

export const jobProgressSchema = z.object({
  stage: z.string(),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
});

export const progressResponseSchema = z.object({
  material: materialSchema,
  job: jobProgressSchema.nullable(),
});

export const uploadResponseSchema = z.object({
  id: z.string(),
  status: materialStatusSchema,
});

export const retryResponseSchema = z.object({
  id: z.string(),
  status: materialStatusSchema,
  /** 重新入队的阶段；没有失败阶段时为 null */
  stage: z.string().nullable(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type MaterialDto = z.infer<typeof materialSchema>;
export type MaterialList = z.infer<typeof materialListSchema>;
export type JobProgressDto = z.infer<typeof jobProgressSchema>;
export type ProgressResponse = z.infer<typeof progressResponseSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type RetryResponse = z.infer<typeof retryResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
