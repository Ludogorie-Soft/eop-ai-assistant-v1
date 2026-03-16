'use client';

import { useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { useRichEditor } from '../hooks/useRichEditor';
import { EditorToolbar } from './EditorToolbar';

interface IntroductionProps {
  rawText: string;
  introductionText: string;
  onIntroductionUpdate: (text: string) => void;
  isFilesProcessing?: boolean;
}

export function Introduction({
  rawText,
  introductionText,
  onIntroductionUpdate,
  isFilesProcessing = false,
}: IntroductionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAiGenerated, setIsAiGenerated] = useState(false);

  const editor = useRichEditor({
    value: introductionText,
    onChange: onIntroductionUpdate,
    onUserInput: () => setIsAiGenerated(false),
    placeholder: 'Текстът на увода ще се появи след AI генериране или може да го въведете ръчно.',
    height: '16rem',
    aiHighlight: isAiGenerated,
  });

  const handleGenerate = async () => {
    if (!rawText.trim()) { setError('Първо качете файлове.'); return; }
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
      if (text) { try { data = JSON.parse(text); } catch { data = {}; } }
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate');
      onIntroductionUpdate(data.introduction ?? '');
      setIsAiGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при генериране на увод');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-neutral-800">Увод</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Редактируем текст. Натиснете „Генерирай увод (AI)" за автоматично създаване.
          </p>
        </div>
        {isAiGenerated && (
          <span className="shrink-0 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
            AI генериран
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={loading || !rawText.trim()}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Генериране...' : 'Генерирай увод (AI)'}
        </button>
      </div>
      {isFilesProcessing && (
        <p className="mt-2 flex items-center gap-2 text-sm text-neutral-500">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
          Файловете се обработват, моля изчакайте…
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div
        className={`mt-3 overflow-hidden rounded-md border transition-all duration-300 ${
          isAiGenerated
            ? 'border-yellow-300 ring-2 ring-yellow-200'
            : 'border-neutral-300 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500'
        }`}
      >
        {editor && <EditorToolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
