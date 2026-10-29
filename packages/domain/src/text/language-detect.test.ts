import { describe, expect, it } from 'vitest';

import {
  detectLanguage,
  HAN_COUNT_THRESHOLD,
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

  it('术语密集的中文课件：汉字占比很低但绝对数足够，判 zh', () => {
    // 还原真实 PPT 形态：16,669 字里 483 个汉字（2.9%）
    const slides = '汉'.repeat(483) + 'a'.repeat(16186);
    expect(detectLanguage(slides)).toBe('zh');
    expect(HAN_RATIO_LOW_THRESHOLD).toBeLessThan(0.029);
  });

  it('英文论文夹零星中文注释：汉字绝对数不足 300，仍判 en', () => {
    const paper = 'a'.repeat(50000) + '汉'.repeat(HAN_COUNT_THRESHOLD - 1);
    expect(detectLanguage(paper)).toBe('en');
  });
});
