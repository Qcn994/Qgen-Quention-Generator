/**
 * 标题感知切块（计划第五节阶段 3）：在章节边界处优先断开，块内不跨标题；
 * 字符区间全部由 `createChunk` 从 normalized_text 切片得到，切片与 text 一致是构造出来的事实。
 * M0 不做 embedding；contentHash 留给跨用户缓存。
 */

import { createHash } from 'node:crypto';

import { assertChunkSequence, createChunk, type Chunk } from '@qgen/domain';

import { pageRangeFor, type NormalizedDocument } from './normalize-document.ts';

export interface ChunkOptions {
  /** 目标块长（字符）。到量后遇到段落边界即断开 */
  readonly targetChars?: number;
  /** 硬上限：单块超过它就一定在段落边界断开 */
  readonly maxChars?: number;
  /** 小于它的尾块尝试并入前一块 */
  readonly minChars?: number;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  targetChars: 900,
  maxChars: 1800,
  minChars: 200,
};

interface Block {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** 非空表示这是标题行 */
  readonly headingLevel: number | null;
}

const HEADING_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly level: number }> = [
  { pattern: /^第[一二三四五六七八九十百零〇\d]+[章讲编篇部]/, level: 1 },
  { pattern: /^第[一二三四五六七八九十百零〇\d]+节/, level: 2 },
  { pattern: /^[一二三四五六七八九十]+、/, level: 2 },
  { pattern: /^[（(][一二三四五六七八九十]+[）)]/, level: 3 },
  { pattern: /^\d+(?:\.\d+){0,3}[、.．\s]/, level: 4 },
  // 英文标题：整行大写且不太长（Week 0 只服务于英文教材的头条）
  { pattern: /^[A-Z][A-Z0-9 ,&'’-]{2,59}$/, level: 2 },
];

function headingLevelOf(line: string): number | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) {
    return null;
  }
  for (const rule of HEADING_RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule.level;
    }
  }
  return null;
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let blockStart = 0;
  let blockLines: string[] = [];
  let offset = 0;

  const flush = (end: number): void => {
    if (blockLines.length === 0) {
      return;
    }
    const headingLevel = blockLines.length === 1 ? headingLevelOf(blockLines[0] ?? '') : null;
    blocks.push({
      start: blockStart,
      end,
      text: text.slice(blockStart, end),
      // 多行块只有在首行是标题时才算标题块，避免把普通段落首行误标
      headingLevel,
    });
    blockLines = [];
  };

  for (const line of text.split('\n')) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    if (line.trim().length === 0) {
      flush(lineStart);
      blockStart = offset;
      continue;
    }

    // 标题单独成块：即使下一行紧跟着正文（PPT/PDF 常见），也不让标题和正文混成一个块
    const level = blockLines.length === 0 ? headingLevelOf(line) : null;
    if (level !== null) {
      flush(lineStart);
      blocks.push({ start: lineStart, end: lineEnd, text: line, headingLevel: level });
      blockStart = offset;
      continue;
    }

    if (blockLines.length === 0) {
      blockStart = lineStart;
    }
    blockLines.push(line);
  }

  flush(Math.min(offset, text.length));
  return blocks;
}

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function chunkDocument(
  document: NormalizedDocument,
  materialId: string,
  options: ChunkOptions = {},
): Chunk[] {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const text = document.normalizedText;
  const blocks = splitBlocks(text);

  interface Draft {
    start: number;
    end: number;
    headingPath: string[];
  }

  const drafts: Draft[] = [];
  const headingStack: Array<{ readonly level: number; readonly text: string }> = [];
  let current: Draft | null = null;

  const flushCurrent = (): void => {
    if (current && current.end > current.start) {
      drafts.push(current);
    }
    current = null;
  };

  for (const block of blocks) {
    if (block.headingLevel !== null) {
      // 新标题出现时清掉同层与更深层，headingPath 只保留祖先链
      while ((headingStack.at(-1)?.level ?? 0) >= block.headingLevel) {
        headingStack.pop();
      }
      headingStack.push({ level: block.headingLevel, text: block.text.trim() });
    }

    const headingPath = headingStack.map((entry) => entry.text);

    if (current === null) {
      current = { start: block.start, end: block.end, headingPath };
      continue;
    }

    const currentLength = current.end - current.start;
    const wouldExceed = currentLength + (block.end - block.start) > settings.maxChars;
    const reachedTarget = currentLength >= settings.targetChars;

    if (block.headingLevel !== null || wouldExceed || reachedTarget) {
      flushCurrent();
      current = { start: block.start, end: block.end, headingPath };
      continue;
    }

    current.end = block.end;
  }
  flushCurrent();

  // 尾块过短：能并就并（不越过硬上限）
  for (let index = drafts.length - 1; index > 0; index -= 1) {
    const tail = drafts[index];
    const previous = drafts[index - 1];
    if (!tail || !previous) {
      continue;
    }
    const tailLength = tail.end - tail.start;
    if (tailLength < settings.minChars && tail.end - previous.start <= settings.maxChars) {
      previous.end = tail.end;
      drafts.splice(index, 1);
    }
  }

  const chunks: Chunk[] = [];
  for (const draft of drafts) {
    // 去掉块首尾空白但保持绝对偏移
    let start = draft.start;
    let end = draft.end;
    while (start < end && /\s/.test(text[start] ?? '')) {
      start += 1;
    }
    while (end > start && /\s/.test(text[end - 1] ?? '')) {
      end -= 1;
    }
    if (end <= start) {
      continue;
    }

    const { pageStart, pageEnd } = pageRangeFor(document.pages, start, end);
    chunks.push(
      createChunk(text, {
        id: `${materialId}-c${chunks.length}`,
        materialId,
        ordinal: chunks.length,
        charStart: start,
        charEnd: end,
        pageStart,
        pageEnd,
        headingPath: draft.headingPath,
        contentHash: hashText(text.slice(start, end)),
      }),
    );
  }

  assertChunkSequence(chunks);
  return chunks;
}
