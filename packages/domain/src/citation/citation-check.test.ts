import { describe, expect, it } from 'vitest';

import { checkCitation } from './citation-check.ts';

const TEXT = '行政处罚与行政强制是两类不同的行政行为。';

function sliceOf(quote: string): { start: number; end: number } {
  const start = TEXT.indexOf(quote);
  return { start, end: start + quote.length };
}

describe('引用逐字校验', () => {
  it('区间切片与引用一致时通过', () => {
    const quote = '行政处罚与行政强制';
    const { start, end } = sliceOf(quote);

    const result = checkCitation({
      text: TEXT,
      charStart: start,
      charEnd: end,
      quote,
      language: 'zh',
    });

    expect(result.ok).toBe(true);
  });

  it('偏移一个字符即失败', () => {
    const quote = '行政处罚与行政强制';
    const { start, end } = sliceOf(quote);

    const result = checkCitation({
      text: TEXT,
      charStart: start + 1,
      charEnd: end + 1,
      quote,
      language: 'zh',
    });

    expect(result).toMatchObject({ ok: false, problem: 'mismatch' });
  });

  it('越界区间失败', () => {
    const result = checkCitation({
      text: TEXT,
      charStart: 0,
      charEnd: TEXT.length + 1,
      quote: TEXT,
      language: 'zh',
    });

    expect(result).toMatchObject({ ok: false, problem: 'out_of_range' });
  });

  it('空区间失败', () => {
    const result = checkCitation({
      text: TEXT,
      charStart: 2,
      charEnd: 2,
      quote: '',
      language: 'zh',
    });

    expect(result).toMatchObject({ ok: false, problem: 'empty_range' });
  });

  it('仅排版差异（全角/空白）仍通过', () => {
    const quote = '行政处罚 与 行政强制';
    const { start, end } = sliceOf('行政处罚与行政强制');

    const result = checkCitation({
      text: TEXT,
      charStart: start,
      charEnd: end,
      quote,
      language: 'zh',
    });

    expect(result.ok).toBe(true);
  });
});
