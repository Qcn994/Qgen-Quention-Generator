/**
 * 文档级归一化：产出 `documents.normalized_text` 与页码区间——引用坐标系的唯一基准。
 * 归一化版本变化会让旧引用区间失效，所以版本号必须与文本一起持久化（计划第三节）。
 */

import { createHash } from 'node:crypto';

import { detectLanguage, type DocumentPage, type MaterialLanguage } from '@qgen/domain';

import type { ExtractedPage } from './extract.ts';

/** 改动归一化规则时递增；旧文档保留旧版本，引用区间不跨版本复用。 */
export const NORMALIZATION_VERSION = 'm0-v2';

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const EXCESS_BLANK_LINES = /\n{3,}/g;

/** 页眉页脚：只把每页首尾各 2 行当候选，出现在足够多页上才算重复（K3 D3 Minor 2） */
const EDGE_LINE_CANDIDATES = 2;
const EDGE_LINE_MIN_PAGES = 4;
const EDGE_LINE_MIN_OCCURRENCES = 3;
/** 超长行是正文段落而不是页眉，不参与判定 */
const EDGE_LINE_MAX_LEN = 80;

export interface NormalizedDocument {
  readonly normalizedText: string;
  readonly pages: readonly DocumentPage[];
  readonly language: MaterialLanguage;
  readonly charCount: number;
  readonly normalizationVersion: string;
  /** normalized_text 的 sha256：后续做跨用户缓存与去重时当键用 */
  readonly contentHash: string;
  /** 被剥离的跨页重复页眉页脚指纹，用于人工复核是否误删正文 */
  readonly strippedEdgeLines: readonly string[];
}

function normalizePageText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(EXCESS_BLANK_LINES, '\n\n')
    .trim();
}

/**
 * 页眉/页脚的指纹：折叠空白，并把数字串归一为 `#`，
 * 这样 "第 12 页 / 共 80 页"、"Page 12" 与 "12" 落在同一个桶里。
 */
function edgeFingerprint(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/\d+/g, '#').trim();
}

/** 每页首尾各 EDGE_LINE_CANDIDATES 行的下标（去重、保持升序） */
function edgeLineIndices(lines: readonly string[]): number[] {
  const head: number[] = [];
  for (let index = 0; index < lines.length && head.length < EDGE_LINE_CANDIDATES; index += 1) {
    if ((lines[index] ?? '').trim().length > 0) {
      head.push(index);
    }
  }
  const tail: number[] = [];
  for (let index = lines.length - 1; index >= 0 && tail.length < EDGE_LINE_CANDIDATES; index -= 1) {
    if ((lines[index] ?? '').trim().length > 0) {
      tail.push(index);
    }
  }
  return [...new Set([...head, ...tail])].sort((a, b) => a - b);
}

/**
 * 剥离跨页重复的页眉页脚。
 *
 * 不追求通用版式识别，只处理最常见的一类："同一行文字（含页眉章节名、页码）出现在多数页的页首或页尾"。
 * 短文档（<4 页有正文）不处理；正文里恰好重复出现的标题因位置不在首尾，不会被误伤。
 * 返回的 `stripped` 是判定为页眉页脚的指纹集合，写进报告供人工抽查。
 */
export function stripRepeatedEdgeLines(pageTexts: readonly string[]): {
  texts: string[];
  stripped: string[];
} {
  const nonEmpty = pageTexts.filter((text) => text.trim().length > 0);
  if (nonEmpty.length < EDGE_LINE_MIN_PAGES) {
    return { texts: [...pageTexts], stripped: [] };
  }

  const occurrences = new Map<string, number>();
  const perPage = pageTexts.map((text) => {
    const lines = text.split('\n');
    const prints = new Map<number, string>();
    for (const index of edgeLineIndices(lines)) {
      const fingerprint = edgeFingerprint(lines[index] ?? '');
      if (fingerprint.length === 0 || fingerprint.length > EDGE_LINE_MAX_LEN) {
        continue;
      }
      prints.set(index, fingerprint);
    }
    for (const fingerprint of new Set(prints.values())) {
      occurrences.set(fingerprint, (occurrences.get(fingerprint) ?? 0) + 1);
    }
    return { lines, prints };
  });

  const threshold = Math.max(
    EDGE_LINE_MIN_OCCURRENCES,
    Math.ceil(nonEmpty.length * 0.4),
  );
  const repeated = new Set(
    [...occurrences.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([fingerprint]) => fingerprint),
  );
  if (repeated.size === 0) {
    return { texts: [...pageTexts], stripped: [] };
  }

  const texts = perPage.map(({ lines, prints }) =>
    lines
      .filter((_, index) => {
        const fingerprint = prints.get(index);
        return fingerprint === undefined || !repeated.has(fingerprint);
      })
      .join('\n'),
  );

  return { texts, stripped: [...repeated].sort() };
}

export function normalizeDocument(pages: readonly ExtractedPage[]): NormalizedDocument {
  const normalizedPages = pages.map((page) => ({
    pageNo: page.pageNo,
    text: normalizePageText(page.text),
  }));
  const { texts, stripped } = stripRepeatedEdgeLines(normalizedPages.map((page) => page.text));

  let normalizedText = '';
  const pageRanges: DocumentPage[] = [];

  for (const [index, page] of normalizedPages.entries()) {
    const text = (texts[index] ?? '').trim();
    if (text.length === 0) {
      continue;
    }
    if (normalizedText.length > 0) {
      normalizedText += '\n\n';
    }
    const charStart = normalizedText.length;
    normalizedText += text;
    pageRanges.push({ pageNo: page.pageNo, charStart, charEnd: normalizedText.length });
  }

  return {
    normalizedText,
    pages: pageRanges,
    language: detectLanguage(normalizedText),
    charCount: normalizedText.length,
    normalizationVersion: NORMALIZATION_VERSION,
    contentHash: createHash('sha256').update(normalizedText, 'utf8').digest('hex'),
    strippedEdgeLines: stripped,
  };
}

/** 某个字符区间覆盖的页码（含起止）；没有页码信息（DOCX）时返回 null。 */
export function pageRangeFor(
  pages: readonly DocumentPage[],
  charStart: number,
  charEnd: number,
): { pageStart: number | null; pageEnd: number | null } {
  const hit = pages.filter((page) => page.charStart < charEnd && page.charEnd > charStart);
  const first = hit[0];
  const last = hit.at(-1);
  return {
    pageStart: first ? first.pageNo : null,
    pageEnd: last ? last.pageNo : null,
  };
}
