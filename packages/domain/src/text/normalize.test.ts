import { describe, expect, it } from 'vitest';

import { normalizeForCompare } from './normalize.ts';

describe('引用归一化', () => {
  it('中文：全角转半角、折叠空白、去零宽字符', () => {
    const raw = '行政处罚​ 与　行政强制';
    expect(normalizeForCompare(raw, 'zh')).toBe('行政处罚与行政强制');
  });

  it('中文：汉字间的空格（PDF 换行残留）被去掉，汉字与数字间保留', () => {
    expect(normalizeForCompare('第 3 章\n行政 处罚', 'zh')).toBe('第 3 章行政处罚');
  });

  it('中文：统一引号与破折号', () => {
    expect(normalizeForCompare('“甲”—“乙”', 'zh')).toBe('"甲"-"乙"');
  });

  it('英文：不做大小写折叠', () => {
    expect(normalizeForCompare('Apple', 'en')).not.toBe(normalizeForCompare('apple', 'en'));
  });

  it('英文：修复行尾断字', () => {
    expect(normalizeForCompare('exam-\nple text', 'en')).toBe('example text');
  });

  it('英文：统一引号与省略号', () => {
    expect(normalizeForCompare('“quoted”…', 'en')).toBe('"quoted"...');
  });

  it('幂等：归一化两次等于一次', () => {
    const samples: Array<[string, 'zh' | 'en']> = [
      ['  “行政  处罚”​ ', 'zh'],
      ['exam-\nple   “text” ', 'en'],
    ];

    for (const [text, language] of samples) {
      const once = normalizeForCompare(text, language);
      expect(normalizeForCompare(once, language)).toBe(once);
    }
  });
});
