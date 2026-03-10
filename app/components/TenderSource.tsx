'use client';

import { useState, useRef } from 'react';

interface TenderSourceProps {
  rawText: string;
  onRawTextUpdate: (text: string) => void;
}

export function TenderSource({ rawText, onRawTextUpdate }: TenderSourceProps) {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const docFiles = files.filter((f) =>
      f.type === 'application/msword' || f.name.toLowerCase().endsWith('.doc')
    );
    if (docFiles.length > 0) {
      setUploadError(
        'Файлове .doc не се поддържат. Моля, конвертирайте ги в .docx или .pdf и опитайте отново.'
      );
      return;
    }

    const valid = files.filter(
      (f) =>
        f.type === 'application/pdf' ||
        f.name.toLowerCase().endsWith('.pdf') ||
        f.type ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        f.name.toLowerCase().endsWith('.docx')
    );

    if (valid.length !== files.length) {
      setUploadError('Разрешени са само PDF и DOCX файлове.');
      return;
    }

    setUploadLoading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      valid.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/parse-files', {
        method: 'POST',
        body: formData,
      });
      const text = await res.text();
      let data: { text?: string; error?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { text?: string; error?: string };
        } catch {
          data = {};
        }
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to parse files');
      setUploadedFiles((prev) => [...prev, ...valid]);
      const newText = data.text ?? '';
      onRawTextUpdate(rawText ? `${newText}\n\n${rawText}` : newText);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to parse files'
      );
    } finally {
      setUploadLoading(false);
    }
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">
        Източник на поръчка
      </h2>

      <div className="mt-4">
        <label className="block text-sm font-medium text-neutral-700">
          Качване на файлове (PDF/DOCX)
        </label>
        <p className="mt-0.5 text-xs text-neutral-500">
          Поддържат се PDF и DOCX. За .doc файлове — конвертирайте ги в .docx преди качване.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          onChange={handleFileSelect}
          className="mt-1 hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadLoading}
          className="mt-1 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {uploadLoading ? 'Обработка...' : 'Избери файлове'}
        </button>
        {uploadError && (
          <p className="mt-1 text-sm text-red-600">{uploadError}</p>
        )}
        {uploadedFiles.length > 0 && (
          <ul className="mt-2 space-y-1">
            {uploadedFiles.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded bg-neutral-50 px-2 py-1 text-sm"
              >
                <span className="truncate">{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="ml-2 text-neutral-500 hover:text-red-600"
                  aria-label="Remove file"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
