/**
 * 引用坐标系（计划第三节）：`documents.normalized_text` 是所有 [charStart, charEnd)
 * 区间的唯一基准。归一化版本变化时旧区间失效，因此版本号随文本一起持久化。
 * M0 只建模结构，解析/归一化在 D3 落地。
 */

export interface DocumentPage {
  /** 1 起的页码 */
  readonly pageNo: number;
  /** 该页在 normalized_text 中的起点（含） */
  readonly charStart: number;
  /** 该页在 normalized_text 中的终点（不含） */
  readonly charEnd: number;
}

export interface Document {
  readonly id: string;
  readonly materialId: string;
  readonly normalizedText: string;
  readonly normalizationVersion: string;
  readonly pages: readonly DocumentPage[];
  readonly createdAt: Date;
}
