/**
 * 题干 simhash（64 位）。M0 不上 embedding，重复检测只有这一层（计划第二节）。
 * 中文按字符二元组、英文按词，字符集之外的内容不参与——题干模板词（"下列说法正确的是"）
 * 在多数题里重复出现，但二元组里它们是少数派，不影响区分度。
 */

import { createHash } from 'node:crypto';

const HAN = /\p{Script=Han}/u;

function tokenize(text: string, language: 'zh' | 'en'): string[] {
  if (language === 'zh') {
    const chars = [...text].filter((char) => HAN.test(char) || /[A-Za-z0-9]/.test(char));
    const tokens: string[] = [];
    for (let index = 0; index + 1 < chars.length; index += 1) {
      tokens.push(`${chars[index]}${chars[index + 1]}`);
    }
    return tokens;
  }

  const words = text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const tokens: string[] = [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    tokens.push(`${words[index]} ${words[index + 1]}`);
  }
  return words.length === 1 ? words : tokens;
}

function hashToken(token: string): bigint {
  const digest = createHash('sha256').update(token, 'utf8').digest();
  return digest.readBigUInt64BE(0);
}

const MASK64 = (1n << 64n) - 1n;

export function simhash64(text: string, language: 'zh' | 'en'): bigint {
  const tokens = tokenize(text, language);
  if (tokens.length === 0) {
    return 0n;
  }

  const weights = new Array<number>(64).fill(0);
  for (const token of tokens) {
    const hash = hashToken(token);
    for (let bit = 0; bit < 64; bit += 1) {
      weights[bit] = (weights[bit] ?? 0) + (((hash >> BigInt(bit)) & 1n) === 1n ? 1 : -1);
    }
  }

  let hash = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if ((weights[bit] ?? 0) > 0) {
      hash |= 1n << BigInt(bit);
    }
  }
  return hash & MASK64;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value > 0n) {
    value &= value - 1n;
    count += 1;
  }
  return count;
}

export const SIMHASH_DUPLICATE_THRESHOLD = 3;

export function isDuplicate(hash: bigint, seen: readonly bigint[]): boolean {
  return seen.some((other) => hammingDistance(hash, other) <= SIMHASH_DUPLICATE_THRESHOLD);
}

export function simhashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, '0');
}

/**
 * 题干精确键（计划里的 stem_hash）：折叠大小写、空白与标点后比较。
 * simhash 对短文本偏噪声——实测改一个词可能相距 5–9 位——所以不能只靠它去重，
 * 先做一次精确键比对，再做 simhash 近似比对。
 */
export function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
