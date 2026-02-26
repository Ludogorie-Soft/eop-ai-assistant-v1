'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface TenderSummary {
  id: string;
  name: string;
  hasIntroduction: boolean;
  smrCount: number;
  createdAt: string;
  updatedAt: string;
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

export function TenderListPage() {
  const router = useRouter();
  const [tenders, setTenders] = useState<TenderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTenders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenders');
      const data = (await res.json()) as {
        tenders?: TenderSummary[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setTenders(data.tenders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при зареждане');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenders();
  }, [fetchTenders]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Нова поръчка' }),
      });
      const data = (await res.json()) as {
        tender?: { id: string };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create');
      if (data.tender?.id) {
        router.push(`/tender/${data.tender.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при създаване');
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Сигурни ли сте, че искате да изтриете „${name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Delete failed');
      await fetchTenders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при изтриване');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold text-neutral-800">
              Tender Technical Generator
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              v1 – Увод, КСС, AI генериране, DOCX експорт
            </p>
          </div>
          <Link
            href="/admin/templates"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Шаблони СМР
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">
            Обществени поръчки
          </h2>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {creating ? 'Създаване...' : 'Добави нова поръчка'}
          </button>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          {loading ? (
            <div className="px-6 py-12 text-center text-sm text-neutral-500">
              Зареждане...
            </div>
          ) : tenders.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-neutral-500">
                Няма запазени поръчки.
              </p>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="mt-3 rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                Добави първата поръчка
              </button>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {tenders.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <Link
                    href={`/tender/${t.id}`}
                    className="min-w-0 flex-1 group"
                  >
                    <span className="text-sm font-medium text-neutral-800 group-hover:text-neutral-600">
                      {t.name || 'Без име'}
                    </span>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-neutral-500">
                      <span>{formatDate(t.updatedAt)}</span>
                      {t.hasIntroduction && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                          Увод
                        </span>
                      )}
                      {t.smrCount > 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                          {t.smrCount} КСС
                        </span>
                      )}
                    </div>
                  </Link>
                  <button
                    onClick={() => handleDelete(t.id, t.name)}
                    className="ml-4 shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Изтрий
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
