import { describe, expect, it } from 'vitest';

import { chunkDocument } from './chunker.ts';
import { normalizeDocument } from './normalize-document.ts';
import type { ExtractedPage } from './extract.ts';

function docFrom(text: string, pageNo = 1) {
  return normalizeDocument([{ pageNo, text }]);
}

describe('文档归一化', () => {
  it('页区间切回原文且偏移单调', () => {
    const document = normalizeDocument([
      { pageNo: 1, text: '第一页内容。\r\n第二行。' },
      { pageNo: 2, text: '第二页内容。' },
    ]);

    expect(document.pages).toHaveLength(2);
    const [first, second] = document.pages;
    expect(document.normalizedText.slice(first?.charStart, first?.charEnd)).toBe('第一页内容。\n第二行。');
    expect(document.normalizedText.slice(second?.charStart, second?.charEnd)).toBe('第二页内容。');
    expect(first!.charEnd).toBeLessThan(second!.charStart);
  });

  it('归一化幂等：同一份文本重复归一化结果不变', () => {
    const once = normalizeDocument([{ pageNo: 1, text: 'Ａ  \n\n\n\n  Ｂ' }]);
    const twice = normalizeDocument([{ pageNo: 1, text: once.normalizedText }]);
    expect(twice.normalizedText).toBe(once.normalizedText);
  });

  it('中文材料判为 zh，英文材料判为 en', () => {
    expect(normalizeDocument([{ pageNo: 1, text: '行政处罚法总则。' }]).language).toBe('zh');
    expect(normalizeDocument([{ pageNo: 1, text: 'Administrative law and its penalties.' }]).language).toBe(
      'en',
    );
  });
});

describe('切块', () => {
  const body = (n: number): ExtractedPage => ({
    pageNo: 1,
    text: Array.from({ length: n }, (_, index) => `第 ${index + 1} 段。${'内容'.repeat(60)}`).join('\n\n'),
  });

  it('切片与 chunk.text 一致、ordinal 连续、不重叠', () => {
    const document = docFrom(body(20).text);
    const chunks = chunkDocument(document, 'm1');

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.ordinal).toBe(index);
      expect(document.normalizedText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
      if (index > 0) {
        expect(chunk.charStart).toBeGreaterThanOrEqual(chunks[index - 1]!.charEnd);
      }
    });
  });

  it('章节标题开新块，并进入 headingPath', () => {
    const text = [
      '第一章 总则',
      '立法目的。'.repeat(40),
      '',
      '第二章 处罚种类',
      '种类说明。'.repeat(40),
    ].join('\n');
    const chunks = chunkDocument(docFrom(text), 'm1');

    const firstHeading = chunks.find((chunk) => chunk.text.startsWith('第一章'));
    const secondHeading = chunks.find((chunk) => chunk.text.startsWith('第二章'));
    expect(firstHeading?.headingPath).toEqual(['第一章 总则']);
    expect(secondHeading?.headingPath).toEqual(['第二章 处罚种类']);
  });

  it('多段内容不超过 maxChars（单段超长除外）', () => {
    const document = docFrom(body(20).text);
    const chunks = chunkDocument(document, 'm1', { maxChars: 1000, targetChars: 600, minChars: 100 });

    chunks.forEach((chunk) => {
      const paragraphs = chunk.text.split('\n\n');
      if (paragraphs.length > 1) {
        expect(chunk.text.length).toBeLessThanOrEqual(1000);
      }
    });
  });

  it('尾部过短的块并入前一块', () => {
    const document = docFrom(`${'长内容。'.repeat(300)}\n\n短尾巴。`);
    const chunks = chunkDocument(document, 'm1', { maxChars: 10000, targetChars: 5000, minChars: 200 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.endsWith('短尾巴。')).toBe(true);
  });

  it('页码区间覆盖块的所有页', () => {
    const document = normalizeDocument([
      { pageNo: 1, text: '第一页'.repeat(60) },
      { pageNo: 2, text: '第二页'.repeat(60) },
    ]);
    const chunks = chunkDocument(document, 'm1', { maxChars: 100000, targetChars: 100000, minChars: 0 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pageStart).toBe(1);
    expect(chunks[0]!.pageEnd).toBe(2);
  });
});
