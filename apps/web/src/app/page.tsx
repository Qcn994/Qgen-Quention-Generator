'use client';

import type { ErrorResponse, MaterialDto, ProgressResponse, UploadResponse } from '@qgen/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

const STATUS_LABEL: Record<string, string> = {
  uploaded: '已上传',
  processing: '处理中',
  ready: '可练习',
  partial: '部分完成',
  failed: '失败',
  archived: '已归档',
};

export default function HomePage() {
  const [materials, setMaterials] = useState<MaterialDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 手动重试后需要重启轮询：轮询 effect 的依赖里加一个递增的令牌
  const [pollToken, setPollToken] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/v1/materials');
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { items: MaterialDto[] };
    setMaterials(data.items);
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    let cancelled = false;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/v1/materials/${activeId}/progress`);
      if (!response.ok || cancelled) {
        return;
      }
      const data = (await response.json()) as ProgressResponse;
      setProgress(data);
      void refreshList();

      if (data.material.status === 'ready' || data.material.status === 'failed') {
        clearInterval(timer);
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeId, pollToken, refreshList]);

  async function retry(id: string): Promise<void> {
    setError(null);
    const response = await fetch(`/api/v1/materials/${id}/retry`, { method: 'POST' });
    if (!response.ok) {
      const data = (await response.json()) as Partial<ErrorResponse>;
      setError(data.error?.message ?? '重试失败');
      return;
    }

    setProgress(null);
    setPollToken((token) => token + 1);
    await refreshList();
  }

  async function upload(file: File): Promise<void> {
    setError(null);
    const form = new FormData();
    form.append('file', file);

    const response = await fetch('/api/v1/materials', { method: 'POST', body: form });
    const data = (await response.json()) as Partial<UploadResponse> & Partial<ErrorResponse>;

    if (!response.ok || !data.id) {
      setError(data.error?.message ?? '上传失败');
      return;
    }

    setActiveId(data.id);
    setProgress(null);
    await refreshList();
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1>QGen 知题</h1>
      <p style={{ color: '#555' }}>上传材料 → 后台解析出题 → 练习与复习。当前为 M0 本地版。</p>

      <section style={{ margin: '24px 0' }}>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.pptx,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void upload(file);
            }
          }}
        />
        {error ? <p style={{ color: '#b00020' }}>{error}</p> : null}
      </section>

      {progress ? (
        <section
          style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}
        >
          <strong>{progress.material.fileName}</strong>
          <div style={{ marginTop: 8 }}>
            状态：{STATUS_LABEL[progress.material.status] ?? progress.material.status}
            {progress.job ? ` · 阶段 ${progress.job.stage} · ${progress.job.progress}%` : null}
          </div>
          <div style={{ background: '#eee', height: 8, borderRadius: 4, marginTop: 8 }}>
            <div
              style={{
                width: `${progress.job?.progress ?? 0}%`,
                background: '#2d6cdf',
                height: 8,
                borderRadius: 4,
              }}
            />
          </div>
          {progress.job?.error ? (
            <p style={{ color: '#b00020' }}>{progress.job.error}</p>
          ) : null}
          {progress.material.status === 'failed' ? (
            <button
              type="button"
              onClick={() => void retry(progress.material.id)}
              style={{ marginTop: 12, padding: '6px 14px', cursor: 'pointer' }}
            >
              重试失败阶段
            </button>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 style={{ fontSize: 18 }}>材料列表</h2>
        <ul style={{ paddingLeft: 20 }}>
          {materials.map((material) => (
            <li key={material.id} style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setActiveId(material.id)}
                style={{ background: 'none', border: 'none', color: '#2d6cdf', cursor: 'pointer', padding: 0 }}
              >
                {material.fileName}
              </button>
              <span style={{ color: '#666', marginLeft: 8 }}>
                {STATUS_LABEL[material.status] ?? material.status}
              </span>
            </li>
          ))}
          {materials.length === 0 ? <li style={{ color: '#666' }}>还没有材料</li> : null}
        </ul>
      </section>
    </main>
  );
}
