import { describe, expect, it } from 'vitest';

import type { Chunk } from '@qgen/domain';

import { locateQuote, pageForOffset } from './locate-quote.ts';

function chunk(overrides: Partial<Chunk> & { text: string; charStart: number }): Chunk {
  const charStart = overrides.charStart;
  return {
    id: overrides.id ?? 'c0',
    materialId: 'm1',
    ordinal: overrides.ordinal ?? 0,
    text: overrides.text,
    charStart,
    charEnd: charStart + overrides.text.length,
    pageStart: overrides.pageStart ?? 1,
    pageEnd: overrides.pageEnd ?? 1,
    headingPath: overrides.headingPath ?? [],
    contentHash: null,
  };
}

describe('locateQuote', () => {
  const doc = '第一段内容。\n第二段：行政处罚是指行政机关依法惩戒的行为。';
  // 在「第二段：」之后切开，保证下面两个引用各自完整落在一个切块内
  const chunks = [
    chunk({ id: 'c0', text: doc.slice(0, 11), charStart: 0 }),
    chunk({ id: 'c1', text: doc.slice(11), charStart: 11, ordinal: 1 }),
  ];

  it('逐字命中时返回绝对偏移，切片与引用一致', () => {
    const quote = '行政处罚是指行政机关依法惩戒的行为。';
    const hit = locateQuote(chunks, quote);

    expect(hit).not.toBeNull();
    expect(hit?.match).toBe('exact');
    expect(hit?.chunk.id).toBe('c1');
    expect(doc.slice(hit?.charStart, hit?.charEnd)).toBe(quote);
  });

  it('引用里的空白与原文换行不同也能定位，且返回原文切片', () => {
    const quote = '第一段内容。 第二段：';
    const hit = locateQuote(chunks, quote);

    expect(hit).not.toBeNull();
    expect(hit?.match).toBe('collapsed');
    expect(doc.slice(hit?.charStart, hit?.charEnd)).toBe('第一段内容。\n第二段：');
  });

  it('跨切块的引用不被接受（引用必须落在单个切块内）', () => {
    expect(locateQuote(chunks, '第一段内容。\n第二段：行政处罚')).toBeNull();
  });

  it('引用不在原文中时返回 null（不猜偏移）', () => {
    expect(locateQuote(chunks, '这段话并不存在于材料之中')).toBeNull();
  });

  it('空白引用返回 null', () => {
    expect(locateQuote(chunks, '   ')).toBeNull();
  });
});

describe('locateQuote 全半角折叠', () => {
  // 真实 PDF 里英文摘要常用全角逗号/引号，模型回抄时会换成半角并补空格
  const text = '他认为：“科学翻译，是场域的工具。”';
  const single = [chunk({ id: 'cf', text, charStart: 100 })];

  it('半角标点 + 多余空格的引用按 folded 命中', () => {
    const hit = locateQuote(single, '他认为: "科学翻译, 是场域的工具。"');

    expect(hit).not.toBeNull();
    expect(hit?.match).toBe('folded');
    expect(hit?.charStart).toBe(100);
    expect(hit?.charEnd).toBe(100 + text.length);
    expect(hit?.quote).toBe(text);
  });

  it('折叠只抹平排版差异：换个字仍然找不到', () => {
    expect(locateQuote(single, '他认为:"科学转译,是场域的工具。"')).toBeNull();
  });
});

describe('locateQuote 行尾断字', () => {
  const text = 'The research on trans-\nformers changed natural language processing.';
  const single = [chunk({ id: 'ch', text, charStart: 0 })];

  it('模型把 de-\\nvelopment 连成 development 后仍能定位', () => {
    const hit = locateQuote(single, 'research on transformers changed');

    expect(hit).not.toBeNull();
    expect(hit?.quote).toBe('research on trans-\nformers changed');
  });

  it('真正的连字符（不在行尾）不受影响', () => {
    const hyphenated = [chunk({ id: 'hh', text: 'a state-of-the-art model', charStart: 0 })];
    expect(locateQuote(hyphenated, 'state-of-the-art model')?.match).toBe('exact');
  });
});

describe('pageForOffset', () => {
  const pages = [
    { pageNo: 1, charStart: 0, charEnd: 10 },
    { pageNo: 2, charStart: 10, charEnd: 20 },
  ];

  it('落在第二页区间内返回页码 2', () => {
    expect(pageForOffset(pages, 15, null)).toBe(2);
  });

  it('页边界归属下一页（左闭右开）', () => {
    expect(pageForOffset(pages, 10, null)).toBe(2);
  });

  it('没有页码信息时回退到切块页码', () => {
    expect(pageForOffset([], 15, 7)).toBe(7);
  });
});
