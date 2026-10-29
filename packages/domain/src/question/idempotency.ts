/**
 * 生成幂等键与确定性 seed（计划第五节「三层幂等/缓存」）。
 *
 * 领域层只负责把参与计算的因素拼成**规范字符串**；真正的 sha256 由基础设施的 Hasher 端口完成
 * （domain 禁止 import node:crypto）。
 *
 * 关键约束：seed 由 (materialId, slot, promptVersion) 确定性派生，且**不进幂等键**——
 * 同一输入重跑得到同一 key、同一随机序列、不重复计费。
 */

/** 单元分隔符：比 "|" 安全，材料 id / 题位里不可能出现 */
const SEP = '\u001f';

export interface IdempotencyKeyInput {
  readonly materialId: string;
  readonly kpId: string;
  readonly slot: string;
  readonly promptVersion: string;
  readonly model: string;
}

export interface SeedInput {
  readonly materialId: string;
  readonly slot: string;
  readonly promptVersion: string;
}

export function idempotencyKeyMaterial(input: IdempotencyKeyInput): string {
  return [input.materialId, input.kpId, input.slot, input.promptVersion, input.model].join(SEP);
}

export function seedMaterial(input: SeedInput): string {
  return [input.materialId, input.slot, input.promptVersion].join(SEP);
}

/**
 * 摘要前 8 位十六进制 → int。同一 (material, slot, promptVersion) 永远得到同一 seed。
 * 传入非法摘要直接抛错，避免静默退化成 0 导致所有题共用同一随机序列。
 */
export function seedFromDigestHex(digestHex: string): number {
  const head = digestHex.slice(0, 8);
  if (!/^[0-9a-fA-F]{8}$/.test(head)) {
    throw new RangeError(`摘要至少需要 8 位十六进制字符，收到: ${digestHex}`);
  }
  return Number.parseInt(head, 16);
}
