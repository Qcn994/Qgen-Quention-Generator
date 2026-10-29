/**
 * 易错点：每个干扰项都要绑定一个 misconception_id。
 * 答错不是二元事件，而是「你把 A 和 B 搞混了」的取证。
 */

export type MisconceptionSeverity = 'low' | 'medium' | 'high';

export interface Misconception {
  readonly id: string;
  readonly kpId: string;
  /** 错误命题本身，例如「行政处罚可以当场限制人身自由」 */
  readonly statement: string;
  /** 为什么这个错误看起来诱人 */
  readonly whyTempting: string;
  /** 正确的对照说法，订正页直接展示 */
  readonly correctContrast: string;
  readonly severity: MisconceptionSeverity;
  readonly evidence: readonly string[];
}

export type MisconceptionProblemCode =
  | 'empty_statement'
  | 'empty_why_tempting'
  | 'empty_correct_contrast'
  | 'unknown_severity';

export interface MisconceptionProblem {
  readonly code: MisconceptionProblemCode;
  readonly message: string;
}

export class InvalidMisconceptionError extends Error {
  readonly problems: readonly MisconceptionProblem[];

  constructor(problems: readonly MisconceptionProblem[]) {
    super(`非法易错点: ${problems.map((problem) => problem.code).join(', ')}`);
    this.name = 'InvalidMisconceptionError';
    this.problems = problems;
  }
}

export interface CreateMisconceptionInput {
  readonly id: string;
  readonly kpId: string;
  readonly statement: string;
  readonly whyTempting: string;
  readonly correctContrast: string;
  readonly severity?: MisconceptionSeverity;
  readonly evidence?: readonly string[];
}

export function createMisconception(input: CreateMisconceptionInput): Misconception {
  const problems: MisconceptionProblem[] = [];
  const statement = input.statement.trim();
  const whyTempting = input.whyTempting.trim();
  const correctContrast = input.correctContrast.trim();
  const severity = input.severity ?? 'medium';

  if (statement.length === 0) {
    problems.push({ code: 'empty_statement', message: '错误命题不能为空' });
  }
  if (whyTempting.length === 0) {
    problems.push({ code: 'empty_why_tempting', message: '必须说明为什么这个错误诱人' });
  }
  if (correctContrast.length === 0) {
    problems.push({ code: 'empty_correct_contrast', message: '必须给出正确的对照说法' });
  }
  if (!['low', 'medium', 'high'].includes(severity)) {
    problems.push({ code: 'unknown_severity', message: `未知的 severity: ${severity}` });
  }

  if (problems.length > 0) {
    throw new InvalidMisconceptionError(problems);
  }

  return {
    id: input.id,
    kpId: input.kpId,
    statement,
    whyTempting,
    correctContrast,
    severity,
    evidence: input.evidence ?? [],
  };
}
