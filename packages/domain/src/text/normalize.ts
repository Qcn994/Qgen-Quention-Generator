/**
 * 引用校验的归一化：只抹平"排版差异"，绝不抹平"语义差异"。
 * 中英规则不同，英文不做大小写折叠——否则 "Apple" 和 "apple" 会被当成同一引用。
 */

export type TextLanguage = 'zh' | 'en';

/** 零宽空格 / 零宽连接符 / BOM */
const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\uFEFF]', 'g');
const WHITESPACE = /\s+/g;
/** 行尾断字：exam-⏎ple → example */
const HYPHEN_LINE_BREAK = /([\p{L}])-[ \t]*\r?\n[ \t]*([\p{L}])/gu;
const DOUBLE_QUOTES = /[“”„‟]/g;
const SINGLE_QUOTES = /[‘’‚‛]/g;
const DASHES = /[–—―]/g;
const ELLIPSIS = /…/g;

export function normalizeForCompare(text: string, language: TextLanguage): string {
  let out = text.normalize('NFKC');
  out = out.replace(ZERO_WIDTH, '');

  if (language === 'en') {
    out = out.replace(HYPHEN_LINE_BREAK, '$1$2');
  }

  out = out
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(DASHES, '-')
    .replace(ELLIPSIS, '...');

  out = out.replace(WHITESPACE, ' ').trim();

  // 中文排版里字符间的空格只可能来自 PDF 换行/分栏，不是语义
  if (language === 'zh') {
    out = out.replace(/(?<=[\p{Script=Han}]) (?=[\p{Script=Han}])/gu, '');
  }

  return out;
}
