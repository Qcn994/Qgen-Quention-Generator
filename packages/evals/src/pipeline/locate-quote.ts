/**
 * 把模型给出的「逐字引用」反算成 normalized_text 上的 [charStart, charEnd)。
 *
 * 为什么不信任模型给偏移：偏移错一个字符就全错，而逐字片段可以由我们自己在原文里定位。
 * PDF 抽出的文本常有软换行，所以先做"忽略空白"的定位：折叠空白后再找，
 * 找到后把位置映射回原始偏移——引用校验本身就比较折叠空白后的文本，两边一致。
 */

import type { Chunk } from '@qgen/domain';

export interface LocatedQuote {
  readonly chunk: Chunk;
  readonly quote: string;
  /** normalized_text 上的绝对偏移 */
  readonly charStart: number;
  readonly charEnd: number;
  /** 匹配方式：exact 逐字命中；collapsed 忽略空白；folded 忽略空白 + 全半角差异 */
  readonly match: 'exact' | 'collapsed' | 'folded';
}

/** 连字符是否正好落在行尾（`trans-\nformers`）；模型回抄时会把这类断字连起来 */
function isLineBreakHyphen(text: string, index: number): boolean {
  return text[index] === '-' && /^[ \t]*\r?\n/.test(text.slice(index + 1, index + 8));
}

function collapse(text: string): { collapsed: string; indices: number[] } {
  let collapsed = '';
  let lastIsLetter = false;
  const indices: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (/\s/.test(char)) {
      continue;
    }
    // 行尾断字：de-\nvelopment 与模型写的 development 视为同一段文字
    if (lastIsLetter && isLineBreakHyphen(text, index)) {
      continue;
    }
    collapsed += char;
    indices.push(index);
    lastIsLetter = /\p{L}/u.test(char);
  }
  return { collapsed, indices };
}

const DOUBLE_QUOTES = /[“”„‟]/g;
const SINGLE_QUOTES = /[‘’‚‛]/g;
const DASHES = /[–—―]/g;

/** 与 domain 的 normalizeForCompare 对齐：NFKC 管全角，弯引号/破折号要单独映射 */
function foldChar(char: string): string {
  return char
    .normalize('NFKC')
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(DASHES, '-')
    .replace(/…/g, '...');
}

/**
 * 逐码点折叠 + 去空白，并记录每个折叠字符来自原文的哪个码元下标。
 * PDF 里英文摘要常用全角逗号/弯引号，模型回抄时会换成半角；这不是语义差异。
 */
function fold(text: string): { folded: string; indices: number[] } {
  let folded = '';
  let lastIsLetter = false;
  const indices: number[] = [];
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const char = String.fromCodePoint(codePoint);
    const width = char.length;
    if (!/\s/.test(char) && !(lastIsLetter && isLineBreakHyphen(text, index))) {
      for (const part of foldChar(char)) {
        folded += part;
        indices.push(index);
      }
      lastIsLetter = /\p{L}/u.test(char);
    }
    index += width;
  }
  return { folded, indices };
}

function locateInChunk(chunk: Chunk, quote: string): LocatedQuote | null {
  const exactIndex = chunk.text.indexOf(quote);
  if (exactIndex >= 0) {
    return {
      chunk,
      quote,
      charStart: chunk.charStart + exactIndex,
      charEnd: chunk.charStart + exactIndex + quote.length,
      match: 'exact',
    };
  }

  const target = collapse(quote).collapsed;
  if (target.length < 4) {
    return null;
  }
  const { collapsed, indices } = collapse(chunk.text);
  const hit = collapsed.indexOf(target);
  if (hit < 0) {
    return null;
  }

  const startInChunk = indices[hit] ?? -1;
  const endInChunk = indices[hit + target.length - 1] ?? -1;
  if (startInChunk < 0 || endInChunk < 0) {
    return null;
  }

  const charStart = chunk.charStart + startInChunk;
  const charEnd = chunk.charStart + endInChunk + 1;
  return {
    chunk,
    quote: chunk.text.slice(startInChunk, endInChunk + 1),
    charStart,
    charEnd,
    match: 'collapsed',
  };
}

function locateFolded(chunk: Chunk, quote: string): LocatedQuote | null {
  const target = fold(quote).folded;
  if (target.length < 4) {
    return null;
  }
  const { folded, indices } = fold(chunk.text);
  const hit = folded.indexOf(target);
  if (hit < 0) {
    return null;
  }

  const startInChunk = indices[hit] ?? -1;
  if (startInChunk < 0) {
    return null;
  }
  // 折叠是一对多（ﬁ → fi）且可能落在代理对上：按码点宽度算结束位置，避免切半个字符
  let endExclusive = startInChunk;
  for (let k = hit; k < hit + target.length; k += 1) {
    const at = indices[k];
    if (at === undefined) {
      continue;
    }
    const codePoint = chunk.text.codePointAt(at);
    const width = codePoint === undefined ? 1 : String.fromCodePoint(codePoint).length;
    endExclusive = Math.max(endExclusive, at + width);
  }

  return {
    chunk,
    quote: chunk.text.slice(startInChunk, endExclusive),
    charStart: chunk.charStart + startInChunk,
    charEnd: chunk.charStart + endExclusive,
    match: 'folded',
  };
}

/** 在给定切块里找引用；找不到返回 null（调用方据此判 citation_exists 失败）。 */
export function locateQuote(chunks: readonly Chunk[], quote: string): LocatedQuote | null {
  const trimmed = quote.trim();
  if (trimmed.length === 0) {
    return null;
  }

  for (const chunk of chunks) {
    const hit = locateInChunk(chunk, trimmed);
    if (hit) {
      return hit;
    }
  }

  // 模型偶尔会把空白压成普通空格或换行位置不同：再试一次折叠形式
  const normalized = trimmed.replace(/\s+/g, ' ');
  if (normalized !== trimmed) {
    for (const chunk of chunks) {
      const hit = locateInChunk(chunk, normalized);
      if (hit) {
        return hit;
      }
    }
  }

  // 最后一档：忽略空白 + 全半角差异（PDF 里的全角逗号/引号被模型回抄成半角）
  for (const chunk of chunks) {
    const hit = locateFolded(chunk, trimmed);
    if (hit) {
      return hit;
    }
  }

  return null;
}

export interface DocumentPageRange {
  readonly pageNo: number;
  readonly charStart: number;
  readonly charEnd: number;
}

/** 引用起点所在页；没有页码信息（DOCX）时回退到切块页码，再回退 null。 */
export function pageForOffset(
  pages: readonly DocumentPageRange[],
  offset: number,
  fallback: number | null,
): number | null {
  const page = pages.find((item) => item.charStart <= offset && offset < item.charEnd);
  return page?.pageNo ?? fallback;
}
