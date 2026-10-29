import { describe, expect, it } from 'vitest';

import { normalizeDocument, stripRepeatedEdgeLines } from './normalize-document.ts';

function pages(texts: readonly string[]): Array<{ pageNo: number; text: string }> {
  return texts.map((text, index) => ({ pageNo: index + 1, text }));
}

describe('stripRepeatedEdgeLines', () => {
  it('剥离跨页重复的页眉（含随页变化的页码）', () => {
    const texts = [
      '第一章 导论\n正文一\n第 1 页 / 共 5 页',
      '第一章 导论\n正文二\n第 2 页 / 共 5 页',
      '第一章 导论\n正文三\n第 3 页 / 共 5 页',
      '第一章 导论\n正文四\n第 4 页 / 共 5 页',
      '第一章 导论\n正文五\n第 5 页 / 共 5 页',
    ];
    const result = stripRepeatedEdgeLines(texts);
    expect(result.texts.every((text) => !text.includes('第一章 导论'))).toBe(true);
    expect(result.texts.every((text) => !text.includes('第 '))).toBe(true);
    expect(result.texts[0]).toBe('正文一');
    expect(result.stripped).toContain('第一章 导论');
    expect(result.stripped).toContain('第 # 页 / 共 # 页');
  });

  it('正文中间重复出现的标题不剥离（位置不在首尾）', () => {
    const texts = ['一', '二', '三', '四'].map(
      (n) => `页眉\n正文${n}甲\n小节标题\n正文${n}乙\n尾行${n}`,
    );
    const result = stripRepeatedEdgeLines(texts);
    expect(result.stripped).toEqual(['页眉']);
    for (const text of result.texts) {
      expect(text).toContain('小节标题');
    }
  });

  it('不足 4 页的文档不判定页眉页脚', () => {
    const texts = ['页眉\n正文一', '页眉\n正文二', '页眉\n正文三'];
    expect(stripRepeatedEdgeLines(texts)).toEqual({ texts, stripped: [] });
  });

  it('只出现在少数页的首行不算页眉', () => {
    const texts = ['偶发标题\n正文一', '正文二', '正文三', '偶发标题\n正文四', '正文五'];
    const result = stripRepeatedEdgeLines(texts);
    expect(result.stripped).toEqual([]);
    expect(result.texts[0]).toBe('偶发标题\n正文一');
  });

  it('超过 80 字的长行不当页眉', () => {
    const long = `摘要${'甲'.repeat(90)}`;
    const texts = ['甲', '乙', '丙', '丁'].map((n) => `${long}\n正文${n}`);
    const result = stripRepeatedEdgeLines(texts);
    expect(result.stripped).toEqual([]);
    expect(result.texts[0]).toContain(long);
  });

  it('不修改入参', () => {
    const texts = ['页眉\n正文一', '页眉\n正文二', '页眉\n正文三', '页眉\n正文四'];
    const snapshot = [...texts];
    stripRepeatedEdgeLines(texts);
    expect(texts).toEqual(snapshot);
  });
});

describe('normalizeDocument', () => {
  it('剥掉页眉后页码区间仍与文本逐字对应', () => {
    const document = normalizeDocument(
      pages([
        '页眉\n第一段正文。\n页脚',
        '页眉\n第二段正文。\n页脚',
        '页眉\n第三段正文。\n页脚',
        '页眉\n第四段正文。\n页脚',
      ]),
    );

    expect(document.strippedEdgeLines).toContain('页眉');
    expect(document.normalizedText).not.toContain('页眉');
    expect(document.normalizedText).not.toContain('页脚');
    for (const page of document.pages) {
      const slice = document.normalizedText.slice(page.charStart, page.charEnd);
      expect(slice.startsWith('第') && slice.endsWith('。')).toBe(true);
    }
    expect(document.pages).toHaveLength(4);
  });

  it('整页只有页眉页脚时该页被丢弃，不留下空页', () => {
    const document = normalizeDocument(
      pages([
        '页眉\n第一段正文。\n页脚',
        '页眉\n页脚',
        '页眉\n第三段正文。\n页脚',
        '页眉\n第四段正文。\n页脚',
      ]),
    );
    expect(document.pages.map((page) => page.pageNo)).toEqual([1, 3, 4]);
    expect(document.normalizedText).not.toContain('页脚');
  });

  it('归一化版本已随规则变更递增', () => {
    const document = normalizeDocument(pages(['正文']));
    expect(document.normalizationVersion).toBe('m0-v2');
  });
});
