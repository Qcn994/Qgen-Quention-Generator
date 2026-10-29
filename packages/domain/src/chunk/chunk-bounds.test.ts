import { describe, expect, it } from 'vitest';

import {
  assertChunkSequence,
  createChunk,
  InvalidChunkError,
  type CreateChunkInput,
} from './chunk.ts';

const DOC = '第一章 总则\n行政处罚是指行政机关依法对违反行政管理秩序的公民、法人或者其他组织进行惩戒的行为。\n第二章 行政强制';

function input(overrides: Partial<CreateChunkInput> = {}): CreateChunkInput {
  return {
    id: 'c1',
    materialId: 'm1',
    ordinal: 0,
    charStart: 0,
    charEnd: 5,
    ...overrides,
  };
}

describe('切块边界', () => {
  it('slice(charStart, charEnd) 恒等于 chunk.text', () => {
    const chunk = createChunk(DOC, input({ charStart: 4, charEnd: 9 }));
    expect(chunk.text).toBe(DOC.slice(4, 9));
    expect(chunk.text).toBe('总则\n行政');
  });

  it('越界（charEnd > 文本长度）抛错', () => {
    expect(() => createChunk(DOC, input({ charEnd: DOC.length + 1 }))).toThrow(InvalidChunkError);
  });

  it('负数起点抛错', () => {
    expect(() => createChunk(DOC, input({ charStart: -1 }))).toThrow(InvalidChunkError);
  });

  it('空区间抛错', () => {
    expect(() => createChunk(DOC, input({ charStart: 3, charEnd: 3 }))).toThrow(InvalidChunkError);
  });

  it('反向区间抛错', () => {
    expect(() => createChunk(DOC, input({ charStart: 5, charEnd: 3 }))).toThrow(InvalidChunkError);
  });

  it('非整数区间抛错', () => {
    expect(() => createChunk(DOC, input({ charEnd: 3.5 }))).toThrow(InvalidChunkError);
  });

  it('允许最后一个切块贴着文本末尾', () => {
    const chunk = createChunk(DOC, input({ charStart: DOC.length - 2, charEnd: DOC.length }));
    expect(chunk.charEnd).toBe(DOC.length);
  });

  it('序列合法：ordinal 连续、按原文顺序、不重叠', () => {
    const chunks = [
      createChunk(DOC, { id: 'a', materialId: 'm1', ordinal: 0, charStart: 0, charEnd: 5 }),
      createChunk(DOC, { id: 'b', materialId: 'm1', ordinal: 1, charStart: 6, charEnd: 11 }),
      createChunk(DOC, { id: 'c', materialId: 'm1', ordinal: 2, charStart: 11, charEnd: 20 }),
    ];
    expect(() => assertChunkSequence(chunks)).not.toThrow();
  });

  it('ordinal 断号抛错', () => {
    const chunks = [
      createChunk(DOC, { id: 'a', materialId: 'm1', ordinal: 0, charStart: 0, charEnd: 5 }),
      createChunk(DOC, { id: 'b', materialId: 'm1', ordinal: 2, charStart: 6, charEnd: 11 }),
    ];
    expect(() => assertChunkSequence(chunks)).toThrow(InvalidChunkError);
  });

  it('相邻切块重叠抛错', () => {
    const chunks = [
      createChunk(DOC, { id: 'a', materialId: 'm1', ordinal: 0, charStart: 0, charEnd: 8 }),
      createChunk(DOC, { id: 'b', materialId: 'm1', ordinal: 1, charStart: 7, charEnd: 11 }),
    ];
    expect(() => assertChunkSequence(chunks)).toThrow(InvalidChunkError);
  });
});
