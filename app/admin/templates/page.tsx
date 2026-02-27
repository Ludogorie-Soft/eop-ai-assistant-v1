'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface TemplateInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("bg-BG", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function TemplateSection({
  title,
  description,
  apiBase,
  downloadBase,
}: {
  title: string;
  description: string;
  apiBase: string;
  downloadBase: string;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase);
      const data = (await res.json()) as {
        templates?: TemplateInfo[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при зареждане");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleUpload = async (file: File) => {
    if (!file.name.endsWith(".docx")) {
      setError("Само .docx файлове са разрешени.");
      return;
    }
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(apiBase, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        positionCount?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const count = data.positionCount ?? 0;
      setSuccessMsg(`Шаблонът е качен успешно. Намерени позиции: ${count}`);
      await fetchTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при качване");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (path: string, name: string) => {
    if (!confirm(`Сигурни ли сте, че искате да изтриете „${name}"?`)) return;
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `${apiBase}?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      await fetchTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при изтриване");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="space-y-4">
      <section
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-neutral-500 bg-neutral-50"
            : "border-neutral-300 bg-white"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p className="text-sm text-neutral-600">
          Плъзнете .docx файл тук или
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="mt-2 rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {uploading ? "Качване..." : "Изберете файл"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
      </section>

      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {successMsg && (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMsg}
        </p>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-800">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-500">
            Зареждане...
          </div>
        ) : templates.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-500">
            Няма качени шаблони. Качете .docx файл по-горе.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {templates.map((t, i) => (
              <div
                key={t.path}
                className="flex items-center justify-between px-6 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-neutral-800">
                      {t.name}
                    </span>
                    {i === 0 && (
                      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Активен
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {formatDate(t.createdAt)} &middot; {formatBytes(t.size)}
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 gap-2">
                  <a
                    href={`${downloadBase}?path=${encodeURIComponent(t.path)}`}
                    download
                    className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Свали
                  </a>
                  <button
                    onClick={() => handleDelete(t.path, t.name)}
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Изтрий
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const REQUIRED_PIN = process.env.NEXT_PUBLIC_TEMPLATES_PIN?.trim() || null;
const PIN_NOT_CONFIGURED = !REQUIRED_PIN;

export default function AdminTemplatesPage() {
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (PIN_NOT_CONFIGURED) return;
    if (pinInput.trim() === REQUIRED_PIN) {
      setAuthorized(true);
      setPinError(null);
    } else {
      setPinError("Невалиден ПИН. Опитайте отново.");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-start justify-between gap-4 px-4 py-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-neutral-800">
              Шаблони
            </h1>
            <p className="mt-1 max-w-xl text-sm text-neutral-600">
              Управление на шаблоните за СМР текстове и длъжности.
              Най-новите активни файлове се използват при AI генериране.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Към главната страница
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-10 px-4 py-8">
        {!authorized ? (
          <section className="mx-auto max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-neutral-800">
              Достъп до шаблоните
            </h2>
            {PIN_NOT_CONFIGURED ? (
              <div className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p>
                  ПИНът не е конфигуриран. Добавете{" "}
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                    NEXT_PUBLIC_TEMPLATES_PIN
                  </code>{" "}
                  в .env файла и рестартирайте приложението, за да активирате достъпа.
                </p>
              </div>
            ) : (
              <>
                <p className="mt-1 text-sm text-neutral-600">
                  Въведете ПИН, за да управлявате СМР и екипни шаблони.
                </p>
                <form onSubmit={handlePinSubmit} className="mt-4 space-y-3">
                  <input
                    type="password"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="ПИН"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
                  />
                  {pinError && (
                    <p className="text-sm text-red-600">{pinError}</p>
                  )}
                  <button
                    type="submit"
                    className="w-full rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Вход
                  </button>
                </form>
              </>
            )}
          </section>
        ) : (
          <>
            <div>
              <h2 className="mb-4 text-lg font-semibold text-neutral-800">
                Шаблони СМР
              </h2>
              <TemplateSection
                title="Качени СМР шаблони"
                description="Най-новият шаблон се използва автоматично при генериране на КСС текстове."
                apiBase="/api/admin/templates"
                downloadBase="/api/admin/templates/download"
              />
            </div>

            <div>
              <h2 className="mb-4 text-lg font-semibold text-neutral-800">
                Шаблон за длъжности
              </h2>
              <TemplateSection
                title="Качени шаблони за длъжности"
                description="Най-новият шаблон се използва автоматично при генериране на организация на екипа."
                apiBase="/api/admin/team-templates"
                downloadBase="/api/admin/team-templates/download"
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

