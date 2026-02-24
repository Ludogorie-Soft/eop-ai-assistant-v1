'use client';

import { useState, useRef } from 'react';

interface TenderSourceProps {
  rawText: string;
  onRawTextUpdate: (text: string) => void;
}

export function TenderSource({ rawText, onRawTextUpdate }: TenderSourceProps) {
  const [caisUrl, setCaisUrl] = useState('');
  const [caisLoading, setCaisLoading] = useState(false);
  const [caisError, setCaisError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFetchCais = async () => {
    if (!caisUrl.trim()) return;
    setCaisLoading(true);
    setCaisError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const res = await fetch('/api/cais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: caisUrl.trim() }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? 'Грешка при зареждане');
      }

      const text = (data as { text?: string }).text ?? '';
      if (text.trim()) {
        onRawTextUpdate(rawText ? `${text}\n\n${rawText}` : text);
      } else {
        setCaisError(
          'Няма извлечен текст. Страницата може да е празна или документите не са намерени. Опитайте да качете файлове ръчно.'
        );
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setCaisError('Заявката отне твърде много време. Опитайте отново.');
      } else {
        setCaisError(err instanceof Error ? err.message : 'Грешка при зареждане от CAIS');
      }
    } finally {
      setCaisLoading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const valid = files.filter(
      (f) =>
        f.type === 'application/pdf' ||
        f.name.toLowerCase().endsWith('.pdf') ||
        f.type === 'application/msword' ||
        f.name.toLowerCase().endsWith('.doc') ||
        f.type ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        f.name.toLowerCase().endsWith('.docx')
    );

    if (valid.length !== files.length) {
      setUploadError('Only PDF, DOC and DOCX files are allowed');
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

      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">
            CAIS линк
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="url"
              value={caisUrl}
              onChange={(e) => setCaisUrl(e.target.value)}
              placeholder="https://www.cais.bg/..."
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            />
            <button
              onClick={handleFetchCais}
              disabled={caisLoading || !caisUrl.trim()}
              className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {caisLoading ? 'Зареждане... (1–2 мин)' : 'Зареди от CAIS'}
            </button>
          </div>
          {caisError && (
            <p className="mt-1 text-sm text-red-600">{caisError}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">
            Качване на файлове (PDF/DOC/DOCX)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
      </div>
    </section>
  );
}
