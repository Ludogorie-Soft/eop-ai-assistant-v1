'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface TemplateInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/templates');
      const data = (await res.json()) as {
        templates?: TemplateInfo[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Грешка при зареждане'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleUpload = async (file: File) => {
    if (!file.name.endsWith('.docx')) {
      setError('Само .docx файлове са разрешени.');
      return;
    }
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/templates', {
        method: 'POST',
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        positionCount?: number;
      };
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      const count = data.positionCount ?? 0;
      setSuccessMsg(
        `Шаблонът е качен успешно. Намерени СМР позиции: ${count}`
      );
      await fetchTemplates();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Грешка при качване'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (path: string, name: string) => {
    if (!confirm(`Сигурни ли сте, че искате да изтриете „${name}"?`)) return;
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `/api/admin/templates?path=${encodeURIComponent(path)}`,
        { method: 'DELETE' }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Delete failed');
      await fetchTemplates();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Грешка при изтриване'
      );
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold text-neutral-800">
              Шаблони СМР
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              Управление на шаблоните за текстове по КСС позиции
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Към главната страница
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {/* Upload zone */}
        <section
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? 'border-neutral-500 bg-neutral-50'
              : 'border-neutral-300 bg-white'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <p className="text-sm text-neutral-600">
            Плъзнете .docx файл тук или
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mt-2 rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {uploading ? 'Качване...' : 'Изберете файл'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
        </section>

        {error && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {successMsg && (
          <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
            {successMsg}
          </p>
        )}

        {/* Templates list */}
        <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-neutral-800">
              Качени шаблони
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Най-новият шаблон се използва автоматично при генериране на КСС
              текстове.
            </p>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-neutral-500">
              Зареждане...
            </div>
          ) : templates.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-neutral-500">
              Няма качени шаблони. Качете .docx файл по-горе.
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {templates.map((t, i) => (
                <div
                  key={t.path}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-800">
                        {t.name}
                      </span>
                      {i === 0 && (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Активен
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {formatDate(t.createdAt)} &middot; {formatBytes(t.size)}
                    </p>
                  </div>
                  <div className="ml-4 flex shrink-0 gap-2">
                    <a
                      href={`/api/admin/templates/download?path=${encodeURIComponent(t.path)}`}
                      download
                      className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      Свали
                    </a>
                    <button
                      onClick={() => handleDelete(t.path, t.name)}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Изтрий
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
