'use client';

import { useState, useRef } from 'react';

export type SmrResult = {
  kssCode: string;
  kssName: string;
  matchedTitle: string | null;
  text: string;
  confidence: number;
};

interface KssSmrSectionProps {
  smrResults: SmrResult[];
  onSmrResultsUpdate: (results: SmrResult[]) => void;
}

function formatResultsAsText(results: SmrResult[]): string {
  if (!results.length) return '';
  return results
    .map(
      (r) =>
        `${r.kssCode} – ${r.kssName} (увереност: ${r.confidence}%)\n${r.text}`
    )
    .join('\n\n---\n\n');
}

export function KssSmrSection({
  smrResults,
  onSmrResultsUpdate,
}: KssSmrSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kssInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    const fileList = kssInputRef.current?.files ?? (document.querySelector('input[name="kssFile"]') as HTMLInputElement)?.files;
    const kssFiles = fileList ? Array.from(fileList) : [];

    if (kssFiles.length === 0) {
      setError('Изберете поне един KSS Excel файл.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      for (const file of kssFiles) {
        formData.append('kssFile', file);
      }

      const res = await fetch('/api/generate-kss-smr', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({})) as {
        results?: SmrResult[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? 'Грешка при генериране');
      }
      onSmrResultsUpdate(data.results ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Грешка при генериране на текстове СМР'
      );
    } finally {
      setLoading(false);
    }
  };

  const displayText = formatResultsAsText(smrResults);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">
        Текстове за КСС (от KSS + Шаблони СМР)
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Можете да качите един или няколко KSS Excel файла. Натиснете „Генерирай текстове СМР за КСС“. Резултатът се показва по-долу и се включва в DOCX при експорт.
      </p>

      <div className="mt-3">
        <label className="block text-sm font-medium text-neutral-700">
          KSS Excel (един или повече файла)
        </label>
        <input
          ref={kssInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          name="kssFile"
          multiple
          className="mt-1 block w-full text-sm text-neutral-600 file:mr-2 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-neutral-700"
        />
      </div>

      <div className="mt-3">
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Генериране...' : 'Генерирай текстове СМР за КСС'}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <textarea
        readOnly
        value={displayText}
        placeholder="Текстовете за КСС ще се появят след генериране."
        className="mt-3 h-64 w-full resize-y rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 placeholder-neutral-400"
        style={{ textAlign: 'justify' }}
      />
    </section>
  );
}
