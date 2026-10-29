import type {
  Question,
  QuestionOption,
  QuestionSourceRef,
  QuestionType,
} from './question.ts';

export type AnswerKeyProblemCode =
  | 'too_few_options'
  | 'duplicate_option_id'
  | 'unknown_option'
  | 'duplicate_answer'
  | 'answer_count'
  | 'no_distractor'
  | 'true_false_shape';

export interface AnswerKeyProblem {
  readonly code: AnswerKeyProblemCode;
  readonly message: string;
}

export class InvalidAnswerKeyError extends Error {
  readonly problems: readonly AnswerKeyProblem[];

  constructor(problems: readonly AnswerKeyProblem[]) {
    super(`非法答案键: ${problems.map((p) => p.code).join(', ')}`);
    this.name = 'InvalidAnswerKeyError';
    this.problems = problems;
  }
}

export interface AnswerKeyShape {
  readonly type: QuestionType;
  readonly options: readonly QuestionOption[];
  readonly answer: readonly string[];
}

export function checkAnswerKey(input: AnswerKeyShape): AnswerKeyProblem[] {
  const problems: AnswerKeyProblem[] = [];
  const optionIds = new Set(input.options.map((option) => option.id));
  const minimumOptions = input.type === 'multiple_choice' ? 3 : 2;

  if (input.options.length < minimumOptions) {
    problems.push({
      code: 'too_few_options',
      message: `${input.type} 至少需要 ${minimumOptions} 个选项`,
    });
  }

  if (optionIds.size !== input.options.length) {
    problems.push({ code: 'duplicate_option_id', message: '选项 id 必须唯一' });
  }

  if (input.answer.length === 0) {
    problems.push({ code: 'answer_count', message: '答案不能为空' });
  }

  for (const answerId of input.answer) {
    if (!optionIds.has(answerId)) {
      problems.push({
        code: 'unknown_option',
        message: `答案 ${answerId} 不在选项中`,
      });
    }
  }

  if (new Set(input.answer).size !== input.answer.length) {
    problems.push({ code: 'duplicate_answer', message: '答案不能重复' });
  }

  if (input.type === 'multiple_choice') {
    if (input.answer.length < 2) {
      problems.push({
        code: 'answer_count',
        message: '多选题至少需要 2 个正确答案',
      });
    }
  } else if (input.answer.length !== 1) {
    problems.push({
      code: 'answer_count',
      message: `${input.type} 必须恰有 1 个正确答案`,
    });
  }

  if (input.type === 'true_false' && input.options.length !== 2) {
    problems.push({
      code: 'true_false_shape',
      message: '判断题必须恰好两个选项',
    });
  }

  const hasDistractor = input.options.some(
    (option) => !input.answer.includes(option.id),
  );
  if (input.options.length > 0 && !hasDistractor) {
    problems.push({ code: 'no_distractor', message: '至少需要一个干扰项' });
  }

  return problems;
}

export function assertValidAnswerKey(input: AnswerKeyShape): void {
  const problems = checkAnswerKey(input);
  if (problems.length > 0) {
    throw new InvalidAnswerKeyError(problems);
  }
}

export interface CreateQuestionInput {
  readonly id: string;
  readonly materialId: string;
  readonly type: QuestionType;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly answer: readonly string[];
  readonly primaryKpId: string;
  readonly explanation?: string;
  readonly difficultyEst?: number;
  readonly kpIds?: readonly string[];
  readonly sourceRefs?: readonly QuestionSourceRef[];
}

/**
 * 构造即校验：非法的答案键不允许进入系统，而不是等到发布时才发现。
 */
export function createQuestion(input: CreateQuestionInput): Question {
  assertValidAnswerKey(input);

  return {
    id: input.id,
    materialId: input.materialId,
    type: input.type,
    stem: input.stem,
    options: input.options,
    answer: input.answer,
    explanation: input.explanation ?? '',
    difficultyEst: input.difficultyEst ?? 3,
    primaryKpId: input.primaryKpId,
    kpIds: input.kpIds ?? [],
    sourceRefs: input.sourceRefs ?? [],
    status: 'candidate',
    version: 1,
  };
}
