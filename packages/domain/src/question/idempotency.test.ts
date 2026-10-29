import { describe, expect, it } from 'vitest';

import { idempotencyKeyMaterial, seedFromDigestHex, seedMaterial } from './idempotency.ts';

const BASE = {
  materialId: 'm-001',
  kpId: 'kp-007',
  slot: 'zh-single-03',
  promptVersion: 'generate-question.v1',
  model: 'qwen-max',
} as const;

describe('生成幂等键', () => {
  it('同输入得到完全相同的键材料（确定性）', () => {
    expect(idempotencyKeyMaterial({ ...BASE })).toBe(idempotencyKeyMaterial({ ...BASE }));
  });

  it('任一因素变化都会改变键材料', () => {
    const key = idempotencyKeyMaterial({ ...BASE });
    expect(idempotencyKeyMaterial({ ...BASE, model: 'deepseek-chat' })).not.toBe(key);
    expect(idempotencyKeyMaterial({ ...BASE, slot: 'zh-single-04' })).not.toBe(key);
    expect(idempotencyKeyMaterial({ ...BASE, promptVersion: 'generate-question.v2' })).not.toBe(key);
    expect(idempotencyKeyMaterial({ ...BASE, kpId: 'kp-008' })).not.toBe(key);
  });

  it('分隔符不会因 id 本身含 "|" 而碰撞', () => {
    const a = idempotencyKeyMaterial({ ...BASE, materialId: 'a|b', kpId: 'c' });
    const b = idempotencyKeyMaterial({ ...BASE, materialId: 'a', kpId: 'b|c' });
    expect(a).not.toBe(b);
  });

  it('seed 由 (material, slot, promptVersion) 派生，模型与知识点不进 seed', () => {
    const seedA = seedMaterial({ materialId: 'm-001', slot: 'zh-single-03', promptVersion: 'v1' });
    const seedB = seedMaterial({ materialId: 'm-001', slot: 'zh-single-03', promptVersion: 'v1' });
    expect(seedA).toBe(seedB);

    // 同一题位、换模型/换知识点，seed 不变（保证重跑同随机序列）
    expect(seedA).not.toContain('qwen-max');
    expect(seedMaterial({ materialId: 'm-001', slot: 'zh-single-04', promptVersion: 'v1' })).not.toBe(seedA);
    expect(seedMaterial({ materialId: 'm-001', slot: 'zh-single-03', promptVersion: 'v2' })).not.toBe(seedA);
  });

  it('seed 不在幂等键里：键材料不包含 seed 的派生输入顺序之外的随机量', () => {
    const key = idempotencyKeyMaterial({ ...BASE });
    expect(key.split('\u001f')).toHaveLength(5);
    expect(seedMaterial({
      materialId: BASE.materialId,
      slot: BASE.slot,
      promptVersion: BASE.promptVersion,
    }).split('\u001f')).toHaveLength(3);
  });

  it('摘要前 8 位转 int：稳定且受校验', () => {
    expect(seedFromDigestHex('abcd1234ffffffff')).toBe(0xabcd1234);
    expect(seedFromDigestHex('abcd1234ffffffff')).toBe(seedFromDigestHex('abcd1234ffffffff'));
    expect(() => seedFromDigestHex('abc')).toThrow(RangeError);
    expect(() => seedFromDigestHex('zzzzzzzz')).toThrow(RangeError);
  });
});
