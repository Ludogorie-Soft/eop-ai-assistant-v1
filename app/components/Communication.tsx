'use client';

import { useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { useRichEditor } from '../hooks/useRichEditor';
import { EditorToolbar } from './EditorToolbar';
import type { SmrResult } from './KssSmrSection';

interface CommunicationProps {
  rawText: string;
  communicationText: string;
  onCommunicationUpdate: (text: string) => void;
  smrResults?: SmrResult[];
}

export function Communication({
  rawText,
  communicationText,
  onCommunicationUpdate,
  smrResults = [],
}: CommunicationProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAiGenerated, setIsAiGenerated] = useState(false);

  const editor = useRichEditor({
    value: communicationText,
    onChange: onCommunicationUpdate,
    onUserInput: () => setIsAiGenerated(false),
    placeholder:
      'Текстът за комуникация ще се появи след AI генериране или може да го въведете ръчно.',
    height: '24rem',
    aiHighlight: isAiGenerated,
  });

  const handleGenerate = async () => {
    if (!rawText.trim()) {
      setError('Първо качете файловете с документацията.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-communication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: rawText,
          kssNames: smrResults.map((r) => r.kssName).filter(Boolean),
        }),
      });
      const text = await res.text();
      let data: { communication?: string; error?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = {};
        }
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate');
      onCommunicationUpdate(data.communication ?? '');
      setIsAiGenerated(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Грешка при генериране на комуникацията',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border-b border-neutral-100 py-10">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">Комуникация</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Редактируем текст.
            Ред и начин за осъществяване на комуникация между участниците в
            строителния процес. Генерира се автоматично от документацията и КСС.
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
          {loading ? 'Генериране...' : 'Генерирай комуникация (AI)'}
        </button>
      </div>
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
