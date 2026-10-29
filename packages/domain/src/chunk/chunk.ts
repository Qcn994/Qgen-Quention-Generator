/**
 * 切块：溯源坐标系的基本单位。
 * 不变量：0 <= charStart < charEnd <= normalizedText.length，且 text === normalizedText.slice(charStart, charEnd)。
 */

export interface Chunk {
  readonly id: string;
  readonly materialId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly headingPath: readonly string[];
  readonly contentHash: string | null;
}

export type ChunkProblemCode =
  | 'invalid_ordinal'
  | 'non_integer_offset'
  | 'out_of_range'
  | 'reversed_range'
  | 'empty_range'
  | 'ordinal_gap'
  | 'overlap';

export interface ChunkProblem {
  readonly code: ChunkProblemCode;
  readonly message: string;
}

export class InvalidChunkError extends Error {
  readonly problems: readonly ChunkProblem[];

  constructor(problems: readonly ChunkProblem[]) {
    super(`非法切块: ${problems.map((problem) => problem.code).join(', ')}`);
    this.name = 'InvalidChunkError';
    this.problems = problems;
  }
}

export interface CreateChunkInput {
  readonly id: string;
  readonly materialId: string;
  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly headingPath?: readonly string[];
  readonly contentHash?: string | null;
}

/**
 * 文本不从外部传入，直接从 normalizedText 切片——这样「切片 === chunk.text」是构造出来的事实，
 * 而不是需要信任调用方的一件事。
 */
export function createChunk(docText: string, input: CreateChunkInput): Chunk {
  const problems = checkChunkBounds(docText, input);
  if (problems.length > 0) {
    throw new InvalidChunkError(problems);
  }

  return {
    id: input.id,
    materialId: input.materialId,
    ordinal: input.ordinal,
    text: docText.slice(input.charStart, input.charEnd),
    charStart: input.charStart,
    charEnd: input.charEnd,
    pageStart: input.pageStart ?? null,
    pageEnd: input.pageEnd ?? null,
    headingPath: input.headingPath ?? [],
    contentHash: input.contentHash ?? null,
  };
}

export function checkChunkBounds(docText: string, input: CreateChunkInput): ChunkProblem[] {
  const problems: ChunkProblem[] = [];

  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
    problems.push({ code: 'invalid_ordinal', message: 'ordinal 必须是非负整数' });
  }

  if (!Number.isInteger(input.charStart) || !Number.isInteger(input.charEnd)) {
    problems.push({ code: 'non_integer_offset', message: '字符区间必须是整数' });
    return problems;
  }

  if (input.charStart < 0 || input.charEnd > docText.length) {
    problems.push({
      code: 'out_of_range',
      message: `字符区间 [${input.charStart}, ${input.charEnd}) 越界（文本长度 ${docText.length}）`,
    });
  }

  if (input.charEnd < input.charStart) {
    problems.push({ code: 'reversed_range', message: 'charEnd 不能小于 charStart' });
  } else if (input.charEnd === input.charStart) {
    problems.push({ code: 'empty_range', message: '空区间不是有效切块' });
  }

  return problems;
}

/**
 * 整份材料的切块序列必须连续：ordinal 从 0 递增、不重叠、按原文顺序。
 */
export function assertChunkSequence(chunks: readonly Chunk[]): void {
  const problems: ChunkProblem[] = [];

  chunks.forEach((chunk, index) => {
    if (chunk.ordinal !== index) {
      problems.push({
        code: 'ordinal_gap',
        message: `第 ${index} 个切块的 ordinal 是 ${chunk.ordinal}，应为 ${index}`,
      });
    }

    const previous = chunks[index - 1];
    if (previous && chunk.charStart < previous.charEnd) {
      problems.push({
        code: 'overlap',
        message: `切块 ${chunk.ordinal} 与前一切块重叠`,
      });
    }
  });

  if (problems.length > 0) {
    throw new InvalidChunkError(problems);
  }
}
