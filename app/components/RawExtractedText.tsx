import { RichTextEditor } from './RichTextEditor';

interface RawExtractedTextProps {
  rawText: string;
}

export function RawExtractedText({ rawText }: RawExtractedTextProps) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">
        Извлечен текст
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Обединен текст от качените PDF/DOCX файлове
      </p>
      <RichTextEditor
        value={rawText}
        readOnly
        placeholder="Текстът ще се появи след качване на файлове."
        height="12rem"
        className="font-mono"
      />
    </section>
  );
}
