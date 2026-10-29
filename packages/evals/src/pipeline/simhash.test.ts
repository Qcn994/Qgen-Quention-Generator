import { describe, expect, it } from 'vitest';

import { hammingDistance, isDuplicate, simhash64, simhashToHex, stemKey } from './simhash.ts';

/**
 * 用真实题干形状（题干 + 选项）做样本。注意：simhash 对短文本偏噪声，
 * 实测改一个词可能相距 5–9 位，所以去重先用 stemKey 做精确比对，simhash 只兜近似。
 */
const BASE_ZH = `行政处罚是通过哪种方式对违反行政管理秩序的行为进行惩戒？
A. 当场限制人身自由
B. 减损权益或者增加义务
C. 任何机关都可以实施的措施
D. 口头警告并要求改正`;

describe('simhash64', () => {
  it('同一文本得到同一指纹（确定性）', () => {
    expect(simhash64(BASE_ZH, 'zh')).toBe(simhash64(BASE_ZH, 'zh'));
  });

  it('近似题干（替换一个选项措辞）汉明距离不超过 3', () => {
    const variant = BASE_ZH.replace('口头警告并要求改正', '书面警告并要求改正');
    expect(hammingDistance(simhash64(BASE_ZH, 'zh'), simhash64(variant, 'zh'))).toBeLessThanOrEqual(
      3,
    );
  });

  it('毫不相关的英文题干汉明距离大于阈值', () => {
    const a = 'Which of the following best describes the principle of legality in administrative law?';
    const b = 'The water cycle consists of evaporation, condensation, and precipitation over oceans.';
    expect(hammingDistance(simhash64(a, 'en'), simhash64(b, 'en'))).toBeGreaterThan(3);
  });

  it('isDuplicate 依据阈值 3 判定', () => {
    const base = simhash64(BASE_ZH, 'zh');
    const near = simhash64(BASE_ZH.replace('口头警告并要求改正', '书面警告并要求改正'), 'zh');
    expect(isDuplicate(near, [base])).toBe(true);
    expect(isDuplicate(simhash64('完全不同的题干：教育是有目的地培养人的社会活动。', 'zh'), [base])).toBe(
      false,
    );
  });

  it('十六进制表示固定 16 位', () => {
    expect(simhashToHex(0n)).toHaveLength(16);
    expect(simhashToHex(simhash64(BASE_ZH, 'zh'))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('stemKey', () => {
  it('折叠大小写、空白与标点后相同', () => {
    expect(stemKey('下列说法，正确的是？')).toBe(stemKey('下列说法 正确的是'));
    expect(stemKey('Which of the following is TRUE?')).toBe(stemKey('which of the following is true'));
  });

  it('语义不同的题干不相等', () => {
    expect(stemKey('行政处罚的定义')).not.toBe(stemKey('行政许可的定义'));
  });
});
