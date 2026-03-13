'use client';

import { EditorContent } from '@tiptap/react';
import { useRichEditor } from '../hooks/useRichEditor';

interface RawExtractedTextProps {
  rawText: string;
}

export function RawExtractedText({ rawText }: RawExtractedTextProps) {
  const editor = useRichEditor({
    value: rawText,
    placeholder: 'Текстът ще се появи след качване на файлове.',
    height: '12rem',
    editable: false,
  });

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">Извлечен текст</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Обединен текст от качените PDF/DOCX файлове
      </p>
      <div className="mt-3 overflow-auto rounded-md border border-neutral-300">
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
