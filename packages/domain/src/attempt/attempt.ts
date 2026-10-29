/**
 * 作答记录。M0 单用户，userId 预留 null；判分结果必须随记录一起落库，
 * 不能事后重算——题目版本可能已变。
 */

import { gradeObjective, type GradeResult } from './grading.ts';
import type { Question } from '../question/question.ts';

export type GradedBy = 'rule' | 'llm' | 'self' | 'teacher';

export interface Attempt {
  readonly id: string;
  readonly questionId: string;
  readonly userId: string | null;
  readonly response: readonly string[];
  readonly correct: boolean;
  readonly score: number;
  readonly missing: readonly string[];
  readonly wrong: readonly string[];
  readonly gradedBy: GradedBy;
  readonly createdAt: Date;
}

export interface CreateAttemptInput {
  readonly id: string;
  readonly question: Question;
  readonly response: readonly string[];
  readonly now: Date;
  readonly userId?: string | null;
  readonly gradedBy?: GradedBy;
}

export function createAttempt(input: CreateAttemptInput): Attempt {
  const grading: GradeResult = gradeObjective(input.question, input.response);

  return {
    id: input.id,
    questionId: input.question.id,
    userId: input.userId ?? null,
    response: input.response,
    correct: grading.correct,
    score: grading.score,
    missing: grading.missing,
    wrong: grading.wrong,
    gradedBy: input.gradedBy ?? 'rule',
    createdAt: input.now,
  };
}
