/**
 * 知识点：出题蓝图的分配单位。
 * importance 决定题量优先级（4–5 先分满），chunkIds 与 evidenceQuotes 是溯源依据。
 */

export type ExamFrequency = 'low' | 'medium' | 'high';

export interface KnowledgePoint {
  readonly id: string;
  readonly materialId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly canonicalName: string;
  readonly summary: string;
  /** 1–5，整数 */
  readonly importance: number;
  /** 1–5，整数 */
  readonly difficulty: number;
  readonly examFrequency: ExamFrequency;
  readonly chunkIds: readonly string[];
  readonly evidenceQuotes: readonly string[];
}

export type KnowledgePointProblemCode =
  | 'empty_name'
  | 'empty_summary'
  | 'importance_range'
  | 'difficulty_range'
  | 'unknown_frequency'
  | 'missing_chunk';

export interface KnowledgePointProblem {
  readonly code: KnowledgePointProblemCode;
  readonly message: string;
}

export class InvalidKnowledgePointError extends Error {
  readonly problems: readonly KnowledgePointProblem[];

  constructor(problems: readonly KnowledgePointProblem[]) {
    super(`非法知识点: ${problems.map((problem) => problem.code).join(', ')}`);
    this.name = 'InvalidKnowledgePointError';
    this.problems = problems;
  }
}

export interface CreateKnowledgePointInput {
  readonly id: string;
  readonly materialId: string;
  readonly name: string;
  readonly summary: string;
  readonly importance: number;
  readonly difficulty?: number;
  readonly parentId?: string | null;
  readonly canonicalName?: string;
  readonly examFrequency?: ExamFrequency;
  readonly chunkIds?: readonly string[];
  readonly evidenceQuotes?: readonly string[];
}

export function createKnowledgePoint(input: CreateKnowledgePointInput): KnowledgePoint {
  const problems: KnowledgePointProblem[] = [];
  const name = input.name.trim();
  const summary = input.summary.trim();

  if (name.length === 0) {
    problems.push({ code: 'empty_name', message: '知识点名称不能为空' });
  }
  if (summary.length === 0) {
    problems.push({ code: 'empty_summary', message: '知识点摘要不能为空' });
  }
  if (!Number.isInteger(input.importance) || input.importance < 1 || input.importance > 5) {
    problems.push({ code: 'importance_range', message: 'importance 必须是 1–5 的整数' });
  }

  const difficulty = input.difficulty ?? 3;
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    problems.push({ code: 'difficulty_range', message: 'difficulty 必须是 1–5 的整数' });
  }

  const examFrequency = input.examFrequency ?? 'medium';
  if (!['low', 'medium', 'high'].includes(examFrequency)) {
    problems.push({ code: 'unknown_frequency', message: `未知的 examFrequency: ${examFrequency}` });
  }

  const chunkIds = input.chunkIds ?? [];
  if (chunkIds.length === 0) {
    problems.push({ code: 'missing_chunk', message: '知识点必须至少引用一个切块' });
  }

  if (problems.length > 0) {
    throw new InvalidKnowledgePointError(problems);
  }

  return {
    id: input.id,
    materialId: input.materialId,
    parentId: input.parentId ?? null,
    name,
    canonicalName: input.canonicalName?.trim() || name,
    summary,
    importance: input.importance,
    difficulty,
    examFrequency,
    chunkIds,
    evidenceQuotes: input.evidenceQuotes ?? [],
  };
}
