'use client';

import { useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { useRichEditor } from '../hooks/useRichEditor';
import { EditorToolbar } from './EditorToolbar';
import type { SmrResult } from './KssSmrSection';

interface TeamOrganizationProps {
  rawText: string;
  teamOrganizationText: string;
  onTeamOrganizationUpdate: (text: string) => void;
  smrResults?: SmrResult[];
}

export function TeamOrganization({
  rawText,
  teamOrganizationText,
  onTeamOrganizationUpdate,
  smrResults = [],
}: TeamOrganizationProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editor = useRichEditor({
    value: teamOrganizationText,
    onChange: onTeamOrganizationUpdate,
    placeholder: 'Текстът за организация на екипа ще се появи след AI генериране или може да го въведете ръчно.',
    height: '16rem',
  });

  const handleGenerate = async () => {
    if (!rawText.trim()) { setError('Първо качете файлове.'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-team-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: rawText,
          kssNames: smrResults.map((r) => r.kssName).filter(Boolean),
        }),
      });
      const text = await res.text();
      let data: { teamOrganization?: string; error?: string } = {};
      if (text) { try { data = JSON.parse(text); } catch { data = {}; } }
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate');
      onTeamOrganizationUpdate(data.teamOrganization ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при генериране на организация на екипа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">Организация на екипа</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Редактируем текст. Натиснете бутона за автоматично генериране от шаблон и документация.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={loading || !rawText.trim()}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Генериране...' : 'Генерирай организация на екипа (AI)'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 overflow-hidden rounded-md border border-neutral-300 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500">
        {editor && <EditorToolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
