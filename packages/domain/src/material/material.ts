export const MATERIAL_STATUSES = [
  'uploaded',
  'processing',
  'ready',
  'partial',
  'failed',
  'archived',
] as const;

export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export interface Material {
  readonly id: string;
  readonly fileName: string;
  readonly sourceType: string;
  readonly contentHash: string | null;
  readonly pageCount: number | null;
  readonly charCount: number | null;
  readonly status: MaterialStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateMaterialInput {
  readonly id: string;
  readonly fileName: string;
  readonly sourceType: string;
  readonly now: Date;
}

export function createMaterial(input: CreateMaterialInput): Material {
  return {
    id: input.id,
    fileName: input.fileName,
    sourceType: input.sourceType,
    contentHash: null,
    pageCount: null,
    charCount: null,
    status: 'uploaded',
    createdAt: input.now,
    updatedAt: input.now,
  };
}
