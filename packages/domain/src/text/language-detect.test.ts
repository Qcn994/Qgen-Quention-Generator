import { describe, expect, it } from 'vitest';

import {
  countHanInHead,
  detectLanguage,
  HAN_COUNT_THRESHOLD,
  HAN_HEAD_MIN,
  HAN_HEAD_WINDOW,
  HAN_RATIO_LOW_THRESHOLD,
  HAN_RATIO_THRESHOLD,
} from './language.ts';

describe('材料语言检测', () => {
  it('纯中文判为 zh', () => {
    expect(detectLanguage('行政处罚与行政强制的区别是什么')).toBe('zh');
  });

  it('纯英文判为 en', () => {
    expect(detectLanguage('Which of the following statements is correct?')).toBe('en');
  });

  it('中文为主、夹英文术语仍判为 zh', () => {
    expect(detectLanguage('公司法上的 piercing the corporate veil 原则称为刺破公司面纱')).toBe('zh');
  });

  it('英文为主、夹少量中文注释仍判为 en', () => {
    expect(detectLanguage('The doctrine of piercing the corporate veil (刺破面纱) limits liability.')).toBe('en');
  });

  it('阈值边界稳定：恰好 30% 判 zh，略低于 30% 判 en', () => {
    // 3 个汉字 + 7 个字母 = 30%
    const exactly = `汉字字${'a'.repeat(7)}`;
    expect(3 / 10).toBe(HAN_RATIO_THRESHOLD);
    expect(detectLanguage(exactly)).toBe('zh');

    // 3 个汉字 + 8 个字母 ≈ 27.3%
    expect(detectLanguage(`汉字字${'a'.repeat(8)}`)).toBe('en');
  });

  it('没有文字信号（数字/标点/空白）时默认 en', () => {
    expect(detectLanguage('1234 —— 5678 !!!')).toBe('en');
    expect(detectLanguage('')).toBe('en');
  });

  it('术语密集的中文课件：汉字占比很低但绝对数足够、且开篇即中文，判 zh', () => {
    // 还原真实 PPT 形态：16,669 字里 483 个汉字（2.9%），开篇前 2000 字内 127 个汉字
    const slides = '汉'.repeat(483) + 'a'.repeat(16186);
    expect(countHanInHead(slides)).toBe(483);
    expect(detectLanguage(slides)).toBe('zh');
    expect(HAN_RATIO_LOW_THRESHOLD).toBeLessThan(0.029);
  });

  it('英文论文夹零星中文注释：汉字绝对数不足 300，仍判 en', () => {
    const paper = 'a'.repeat(50000) + '汉'.repeat(HAN_COUNT_THRESHOLD - 1);
    expect(detectLanguage(paper)).toBe('en');
  });

  it('K3 Major 5 必带用例：正文英文、夹大量中文批注（1013 形态）判 en', () => {
    // 还原 1013：汉字 979 个 / 占比 2.31%，但开篇前 2000 字只有 4 个汉字
    const journal = `${'a'.repeat(1996)}汉汉汉汉${'b'.repeat(5000)}${'汉'.repeat(975)}${'a'.repeat(35000)}`;
    expect(countHanInHead(journal)).toBe(4);
    expect(detectLanguage(journal)).toBe('en');
  });

  it('K3 Major 5 必带用例：英文术语授课的中文课件（PPT 形态）判 zh', () => {
    // 开篇一段中文导论，之后是大量英文术语——前 2000 字内汉字数过线
    const slides = `${'中文讲授的机器学习课程导论，本节讲解监督学习的基本概念。'.repeat(13)}${'a'.repeat(10000)}`;
    expect(countHanInHead(slides)).toBeGreaterThanOrEqual(HAN_HEAD_MIN);
    expect(detectLanguage(slides)).toBe('zh');
  });

  it('第三条件边界：前 2000 字汉字数 50 判 zh、49 判 en', () => {
    const make = (headHan: number): string =>
      `${'汉'.repeat(headHan)}${'a'.repeat(HAN_HEAD_WINDOW - headHan)}${'汉'.repeat(HAN_COUNT_THRESHOLD - headHan)}${'a'.repeat(2000)}`;

    const atThreshold = make(HAN_HEAD_MIN);
    expect(countHanInHead(atThreshold)).toBe(HAN_HEAD_MIN);
    expect(detectLanguage(atThreshold)).toBe('zh');

    const belowThreshold = make(HAN_HEAD_MIN - 1);
    expect(countHanInHead(belowThreshold)).toBe(HAN_HEAD_MIN - 1);
    expect(detectLanguage(belowThreshold)).toBe('en');
  });

  it('汉字占比 ≥30% 时直接判 zh，不看开篇窗口', () => {
    const zhAtEnd = `${'a'.repeat(2000)}${'汉'.repeat(1000)}`;
    expect(countHanInHead(zhAtEnd)).toBe(0);
    expect(detectLanguage(zhAtEnd)).toBe('zh');
  });
});
