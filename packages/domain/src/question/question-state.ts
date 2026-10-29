import type { Question, QuestionStatus } from './question.ts';

/**
 * 状态机是发布门禁的最后一道闸：任何不在表内的迁移都必须抛错，
 * 包括 published → verifying 这种"看起来无害"的回退。
 */
const ALLOWED_TRANSITIONS: Readonly<Record<QuestionStatus, readonly QuestionStatus[]>> = {
  candidate: ['verifying'],
  verifying: ['auto_passed', 'needs_review', 'quarantined', 'rejected'],
  auto_passed: ['published', 'needs_review', 'quarantined'],
  published: ['quarantined', 'retired'],
  needs_review: ['published', 'quarantined', 'rejected'],
  quarantined: ['verifying', 'rejected'],
  retired: [],
  rejected: [],
};

export class IllegalTransitionError extends Error {
  readonly from: QuestionStatus;
  readonly to: QuestionStatus;

  constructor(from: QuestionStatus, to: QuestionStatus) {
    super(`非法状态迁移: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: QuestionStatus, to: QuestionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: QuestionStatus, to: QuestionStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

/** 迁移返回新对象，隐藏就地修改 */
export function transition(question: Question, to: QuestionStatus): Question {
  assertTransition(question.status, to);
  return { ...question, status: to, version: question.version + 1 };
}

export function isLearnerVisible(question: Pick<Question, 'status'>): boolean {
  return question.status === 'published';
}
