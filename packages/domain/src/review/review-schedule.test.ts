import { describe, expect, it } from 'vitest';

import {
  addDays,
  createReviewCard,
  REVIEW_INTERVALS_DAYS,
  scheduleAfterAttempt,
} from './review-schedule.ts';

const NOW = new Date('2026-10-25T00:00:00.000Z');

describe('固定间隔复习排期', () => {
  it('新卡排在 1 天后', () => {
    const card = createReviewCard(NOW);
    expect(card.intervalIndex).toBe(0);
    expect(card.dueAt).toEqual(addDays(NOW, 1));
    expect(card.graduated).toBe(false);
  });

  it('答对后推进到 3 天档', () => {
    const card = scheduleAfterAttempt(createReviewCard(NOW), true, NOW);
    expect(card.intervalIndex).toBe(1);
    expect(card.dueAt).toEqual(addDays(NOW, 3));
    expect(card.consecutiveCorrect).toBe(1);
  });

  it('答错从任何档位重置回第 1 天档', () => {
    let card = createReviewCard(NOW);
    card = scheduleAfterAttempt(card, true, NOW); // 3 天
    card = scheduleAfterAttempt(card, true, NOW); // 毕业

    const afterWrong = scheduleAfterAttempt(
      { ...card, graduated: false, consecutiveCorrect: 0, intervalIndex: 3 },
      false,
      NOW,
    );

    expect(afterWrong.intervalIndex).toBe(0);
    expect(afterWrong.dueAt).toEqual(addDays(NOW, 1));
    expect(afterWrong.consecutiveCorrect).toBe(0);
    expect(afterWrong.graduated).toBe(false);
  });

  it('连续答对 2 次后移出队列', () => {
    let card = createReviewCard(NOW);
    card = scheduleAfterAttempt(card, true, NOW);
    expect(card.graduated).toBe(false);

    card = scheduleAfterAttempt(card, true, NOW);
    expect(card.graduated).toBe(true);
  });

  it('档位不会越过 15 天', () => {
    let card = { ...createReviewCard(NOW), intervalIndex: 3, consecutiveCorrect: 0 };
    card = scheduleAfterAttempt(card, true, NOW);
    expect(REVIEW_INTERVALS_DAYS[card.intervalIndex]).toBe(15);
  });
});
