'use client';

import { useState } from 'react';

interface IntroductionProps {
  rawText: string;
  introductionText: string;
  onIntroductionUpdate: (text: string) => void;
}

export function Introduction({
  rawText,
  introductionText,
  onIntroductionUpdate,
}: IntroductionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!rawText.trim()) {
      setError('Първо заредете данни от CAIS или качете файлове.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-introduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText: rawText }),
      });
      const text = await res.text();
      let data: { introduction?: string; error?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { introduction?: string; error?: string };
        } catch {
          data = {};
        }
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate');
      onIntroductionUpdate(data.introduction ?? '');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Грешка при генериране на увод'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">Увод</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Редактируем текст. Натиснете „Генерирай увод (AI)" за автоматично създаване.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={loading || !rawText.trim()}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Генериране...' : 'Генерирай увод (AI)'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <textarea
        value={introductionText}
        onChange={(e) => onIntroductionUpdate(e.target.value)}
        placeholder="Текстът на увода ще се появи след AI генериране или може да го въведете ръчно."
        className="mt-3 h-64 w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
        style={{ textAlign: 'justify' }}
      />
    </section>
  );
}
