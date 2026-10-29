import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from '@qgen/config';

import { getContainer } from '@/server/container';
import { toMaterialList } from '@/server/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 200 * 1024 * 1024;

export async function GET(): Promise<Response> {
  const items = await getContainer().materials.list(50);
  return Response.json(toMaterialList(items));
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json(
      { error: { code: 'file_missing', message: '缺少文件字段 file' } },
      { status: 400 },
    );
  }

  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json(
      { error: { code: 'file_size', message: '文件为空或超过 200MB' } },
      { status: 400 },
    );
  }

  // M0 直接落本地磁盘；M1 换 OSS 适配器，用例不变。
  // 先落盘再建材料：写盘失败时不会留下"有材料行、有 pending 任务、没有文件"的孤儿记录。
  // 文件名的 materialId 前缀要等材料建好才知道，所以先写临时名再 rename（同目录 rename 是原子的）。
  const uploadDir = resolve(loadConfig().dataDir, 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const safeName = file.name.replace(/[\\/:*?"<>|]/g, '_');
  const tmpPath = resolve(uploadDir, `.tmp-${randomUUID()}-${safeName}`);
  await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));

  const container = getContainer();
  const material = await container.ingestMaterial
    .execute({
      fileName: file.name,
      sourceType: file.type || 'application/octet-stream',
    })
    .catch(async (error: unknown) => {
      await rm(tmpPath, { force: true });
      throw error;
    });

  await rename(tmpPath, resolve(uploadDir, `${material.id}-${safeName}`));

  return Response.json({ id: material.id, status: material.status }, { status: 201 });
}
