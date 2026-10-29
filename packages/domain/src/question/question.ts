/**
 * 题目实体：纯数据 + 不变量。这里不出现任何 IO、随机数或时间。
 */

export const QUESTION_STATUSES = [
  'candidate',
  'verifying',
  'auto_passed',
  'published',
  'needs_review',
  'quarantined',
  'retired',
  'rejected',
] as const;

export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_TYPES = [
  'single_choice',
  'multiple_choice',
  'true_false',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** 只有 published 对学习者可见 */
export const LEARNER_VISIBLE_STATUSES: readonly QuestionStatus[] = ['published'];

export interface QuestionOption {
  readonly id: string;
  readonly text: string;
  /** 该干扰项针对的误区；正确选项为 null */
  readonly misconceptionId: string | null;
}

export type SourceRole = 'answer_basis' | 'distractor_basis' | 'context';

export interface QuestionSourceRef {
  readonly chunkId: string;
  readonly quote: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly pageNo: number;
  readonly role: SourceRole;
}

export interface Question {
  readonly id: string;
  readonly materialId: string;
  readonly type: QuestionType;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly answer: readonly string[];
  readonly explanation: string;
  readonly difficultyEst: number;
  readonly primaryKpId: string;
  readonly kpIds: readonly string[];
  readonly sourceRefs: readonly QuestionSourceRef[];
  readonly status: QuestionStatus;
  readonly version: number;
}
