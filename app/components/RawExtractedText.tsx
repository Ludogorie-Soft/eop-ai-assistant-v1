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
        Обединен текст от CAIS и качените PDF/DOCX файлове
      </p>
      <textarea
        readOnly
        value={rawText}
        placeholder="Текстът ще се появи след зареждане от CAIS или качване на файлове."
        className="mt-3 h-48 w-full resize-y rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none"
      />
    </section>
  );
}
