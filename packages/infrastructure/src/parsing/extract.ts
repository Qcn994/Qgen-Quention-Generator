/**
 * D3 spike 的解析层：PDF / DOCX / PPTX / TXT → 按页的原始文本。
 * 只做"把文字拿出来"，归一化与切块在 normalize-document.ts / chunker.ts。
 * 扫描件（无文字层）不在 M0 范围：抽不到文本即报 empty_document，绝不猜。
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';

export interface ExtractedPage {
  readonly pageNo: number;
  readonly text: string;
}

export interface ExtractedDocument {
  readonly sourceType: string;
  readonly pages: readonly ExtractedPage[];
}

export type ExtractErrorCode = 'unsupported_type' | 'empty_document' | 'parse_failed';

export class ExtractError extends Error {
  constructor(
    readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractError';
  }
}

export const SOURCE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/plain',
} as const;

export function sourceTypeFor(path: string): string | null {
  const ext = extname(path).toLowerCase().replace(/^\./, '');
  return SOURCE_TYPES[ext as keyof typeof SOURCE_TYPES] ?? null;
}

export async function extractDocument(path: string): Promise<ExtractedDocument> {
  const sourceType = sourceTypeFor(path);
  if (!sourceType) {
    throw new ExtractError('unsupported_type', `不支持的文件类型: ${path}`);
  }

  const buffer = await readFile(path);
  let pages: ExtractedPage[];

  try {
    if (sourceType === SOURCE_TYPES.pdf) {
      pages = await extractPdf(buffer);
    } else if (sourceType === SOURCE_TYPES.docx) {
      pages = await extractDocx(buffer);
    } else if (sourceType === SOURCE_TYPES.pptx) {
      pages = await extractPptx(buffer);
    } else {
      pages = extractText(buffer);
    }
  } catch (error) {
    if (error instanceof ExtractError) {
      throw error;
    }
    throw new ExtractError(
      'parse_failed',
      `解析失败 ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const nonEmpty = pages.filter((page) => page.text.trim().length > 0);
  if (nonEmpty.length === 0) {
    throw new ExtractError('empty_document', `没有抽到任何文字（可能是扫描件）: ${path}`);
  }

  return { sourceType, pages };
}

interface PdfTextItemShape {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly hasEOL: boolean;
}

const ASCII_WORD = /[A-Za-z0-9]/;

/** 同一行内的英文词间距：只在前一个字符是 ASCII 字母数字时补空格，避免把中文切出空格 */
function needsSpace(previousEndX: number, x: number, height: number, previous: string, next: string): boolean {
  if (previousEndX <= 0 || x <= previousEndX) {
    return false;
  }
  const gap = x - previousEndX;
  const prevChar = previous.at(-1) ?? '';
  const nextChar = next.at(0) ?? '';
  return gap > Math.max(1, height * 0.25) && ASCII_WORD.test(prevChar) && ASCII_WORD.test(nextChar);
}

function itemsToText(items: readonly unknown[]): string {
  let out = '';
  let lastY: number | null = null;
  let lastEndX = 0;
  let lastHeight = 12;

  for (const raw of items) {
    const item = raw as Partial<PdfTextItemShape>;
    if (typeof item.str !== 'string' || item.str.length === 0) {
      continue;
    }

    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = typeof transform[4] === 'number' ? transform[4] : 0;
    const y = typeof transform[5] === 'number' ? transform[5] : null;
    const height = typeof item.height === 'number' && item.height > 0 ? item.height : lastHeight;

    if (out.length > 0 && !out.endsWith('\n')) {
      const lineBreak = lastY !== null && y !== null && Math.abs(y - lastY) > Math.max(1, height * 0.5);
      if (lineBreak) {
        out += '\n';
      } else if (needsSpace(lastEndX, x, height, out, item.str)) {
        out += ' ';
      }
    }

    out += item.str;
    if (item.hasEOL === true && !out.endsWith('\n')) {
      out += '\n';
    }

    lastY = y ?? lastY;
    lastEndX = x + (typeof item.width === 'number' ? item.width : 0);
    lastHeight = height;
  }

  return out;
}

async function extractPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  // 动态加载：只有真正的 PDF 才付这份解析成本，worker/web 的其他路径不受影响。
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // 标准 14 字体的字宽数据：不给路径时 pdfjs 会对每个未内嵌字体刷警告（文字层仍可抽出）。
  // Node 下的 pdfjs 用 fs 直接读这个路径，不认 file:// URL。
  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve('pdfjs-dist/package.json'));
  const fontDataUrl = resolve(packageDir, 'standard_fonts') + '/';
  // 中文 PDF 多用 Adobe-GB1 等预定义 CMap，字体本身不带 ToUnicode：不给 cMapUrl 时 pdfjs
  // 取不到字形→unicode 映射，抽出来的汉字会全部变成空白/乱码（实测《上海翻译》论文汉字占比 0.0%）。
  const cMapUrl = resolve(packageDir, 'cmaps') + '/';

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    standardFontDataUrl: fontDataUrl,
    cMapUrl,
    cMapPacked: true,
  });
  const pages: ExtractedPage[] = [];

  try {
    const document = await task.promise;
    for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push({ pageNo, text: itemsToText(content.items) });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  return pages;
}

interface MammothLike {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}

async function extractDocx(buffer: Buffer): Promise<ExtractedPage[]> {
  // mammoth 是 CJS（export =），ESM 动态导入后取 default 才是实例
  const loaded = (await import('mammoth')) as unknown as MammothLike & { default?: MammothLike };
  const mammoth: MammothLike | undefined =
    typeof loaded.extractRawText === 'function' ? loaded : loaded.default;
  if (!mammoth) {
    throw new ExtractError('parse_failed', 'mammoth 加载失败');
  }

  const result = await mammoth.extractRawText({ buffer });
  // DOCX 没有可靠的分页信息：整份作为一个逻辑页，页码留空由后续阶段处理。
  return [{ pageNo: 1, text: result.value }];
}

interface PreserveOrderNode {
  readonly [key: string]: unknown;
}

/** XMLParser({ preserveOrder: true }) 的产物是数组，按文档顺序收集 a:t 文本 */
function collectSlideText(nodes: readonly unknown[], out: string[]): void {
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    const record = node as PreserveOrderNode;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'a:t') {
        if (Array.isArray(value)) {
          for (const child of value) {
            if (typeof child === 'object' && child !== null) {
              const text = (child as { '#text'?: unknown })['#text'];
              if (typeof text === 'string' || typeof text === 'number') {
                out.push(String(text));
              }
            }
          }
        }
        continue;
      }
      if (Array.isArray(value)) {
        collectSlideText(value, out);
      }
    }
  }
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

interface ZipEntry {
  async(type: 'string'): Promise<string>;
}

interface ZipArchive {
  readonly files: Record<string, unknown>;
  file(name: string): ZipEntry | null;
}

interface ZipLoader {
  loadAsync(data: Buffer): Promise<ZipArchive>;
}

async function extractPptx(buffer: Buffer): Promise<ExtractedPage[]> {
  const [jszipModule, fxpModule] = await Promise.all([import('jszip'), import('fast-xml-parser')]);
  const zipModule = jszipModule as unknown as ZipLoader & { default?: ZipLoader };
  const loader: ZipLoader = typeof zipModule.loadAsync === 'function' ? zipModule : zipModule.default!;
  const zip = await loader.loadAsync(buffer);
  const parser = new fxpModule.XMLParser({ ignoreAttributes: true, preserveOrder: true });

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const pages: ExtractedPage[] = [];
  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) {
      continue;
    }
    const xml = await file.async('string');
    const texts: string[] = [];
    collectSlideText(parser.parse(xml) as unknown[], texts);
    pages.push({ pageNo: slideNumber(name), text: texts.join('\n') });
  }

  return pages;
}

function extractText(buffer: Buffer): ExtractedPage[] {
  const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
  // 文本文件用换页符 \f 模拟分页；没有就整份一页。
  const parts = raw.includes('\f') ? raw.split('\f') : [raw];
  return parts.map((text, index) => ({ pageNo: index + 1, text }));
}
