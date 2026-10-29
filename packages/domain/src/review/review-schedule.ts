/**
 * M0 复习排期：固定 1/3/7/15 天。
 * 字段形状按 FSRS 的 card 预留，M1 换算法时不改表结构。
 */

export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 15] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewCard {
  readonly intervalIndex: number;
  readonly dueAt: Date;
  readonly consecutiveCorrect: number;
  readonly graduated: boolean;
}

export function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

function intervalDaysAt(index: number): number {
  const days = REVIEW_INTERVALS_DAYS[index];
  if (days === undefined) {
    throw new RangeError(`复习档位越界: ${index}`);
  }
  return days;
}

export function createReviewCard(now: Date): ReviewCard {
  return {
    intervalIndex: 0,
    dueAt: addDays(now, intervalDaysAt(0)),
    consecutiveCorrect: 0,
    graduated: false,
  };
}

/**
 * 答错立即重置回第 1 天档——不是"降一级"。
 * 连续答对 2 次后移出队列（graduated），因为固定间隔体系下
 * 再排下去间隔会超过考试周期。
 */
export function scheduleAfterAttempt(
  card: ReviewCard,
  correct: boolean,
  now: Date,
): ReviewCard {
  if (!correct) {
    return {
      intervalIndex: 0,
      dueAt: addDays(now, intervalDaysAt(0)),
      consecutiveCorrect: 0,
      graduated: false,
    };
  }

  const consecutiveCorrect = card.consecutiveCorrect + 1;
  if (consecutiveCorrect >= 2) {
    return {
      intervalIndex: card.intervalIndex,
      dueAt: card.dueAt,
      consecutiveCorrect,
      graduated: true,
    };
  }

  const intervalIndex = Math.min(
    card.intervalIndex + 1,
    REVIEW_INTERVALS_DAYS.length - 1,
  );
  return {
    intervalIndex,
    dueAt: addDays(now, intervalDaysAt(intervalIndex)),
    consecutiveCorrect,
    graduated: false,
  };
}
