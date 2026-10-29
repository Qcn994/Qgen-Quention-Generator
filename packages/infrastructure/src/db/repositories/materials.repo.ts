import { desc, eq } from 'drizzle-orm';

import type { MaterialRepository } from '@qgen/application';
import type { Material, MaterialStatus } from '@qgen/domain';

import type { Db } from '../client.ts';
import { materials } from '../schema.ts';

type MaterialRow = typeof materials.$inferSelect;

function toMaterial(row: MaterialRow): Material {
  return {
    id: row.id,
    fileName: row.fileName,
    sourceType: row.sourceType,
    contentHash: row.contentHash,
    pageCount: row.pageCount,
    charCount: row.charCount,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteMaterialRepository implements MaterialRepository {
  constructor(private readonly db: Db) {}

  async create(material: Material): Promise<void> {
    this.db.insert(materials).values(material).run();
  }

  async findById(id: string): Promise<Material | null> {
    const row = this.db.select().from(materials).where(eq(materials.id, id)).get();
    return row ? toMaterial(row) : null;
  }

  async list(limit: number): Promise<Material[]> {
    const rows = this.db
      .select()
      .from(materials)
      .orderBy(desc(materials.createdAt))
      .limit(limit)
      .all();
    return rows.map(toMaterial);
  }

  async updateStatus(id: string, status: MaterialStatus, updatedAt: Date): Promise<void> {
    this.db.update(materials).set({ status, updatedAt }).where(eq(materials.id, id)).run();
  }
}
