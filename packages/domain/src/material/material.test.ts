import { describe, expect, it } from 'vitest';

import { createMaterial } from './material.ts';

describe('材料实体', () => {
  it('新材料初始状态为 uploaded，统计字段为空', () => {
    const now = new Date('2026-10-25T00:00:00.000Z');
    const material = createMaterial({
      id: 'm1',
      fileName: '民法学讲义.pdf',
      sourceType: 'application/pdf',
      now,
    });

    expect(material.status).toBe('uploaded');
    expect(material.pageCount).toBeNull();
    expect(material.charCount).toBeNull();
    expect(material.createdAt).toEqual(now);
  });
});
