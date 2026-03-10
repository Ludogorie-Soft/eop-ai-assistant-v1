'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface TemplateInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

interface OfferInfo {
  id: string;
  name: string;
  filename: string;
  storage_path: string;
  file_size: number;
  section_count: number;
  created_at: string;
}

interface OfferSection {
  id: string;
  offer_id: string;
  section_type: string;
  title: string;
  html_content: string;
  plain_text: string;
  order_index: number;
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

const SECTION_TYPE_LABELS: Record<string, string> = {
  introduction: "Увод",
  smr_technology: "СМР Технология",
  team_organization: "Организация на екипа",
  communication: "Комуникация",
  other: "Друго",
};

const SECTION_TYPE_COLORS: Record<string, string> = {
  introduction: "bg-blue-100 text-blue-800",
  smr_technology: "bg-orange-100 text-orange-800",
  team_organization: "bg-purple-100 text-purple-800",
  communication: "bg-teal-100 text-teal-800",
  other: "bg-neutral-100 text-neutral-700",
};

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

// ─────────────────────────────────────────────────────────────────────────────
// OfferUploadsSection: manages complete Technical Proposals for self-learning
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

/** Inner component: sidebar + content viewer for a loaded set of sections.
 *  Non-SMR sections are individual nav items.
 *  SMR sections appear individually under a non-clickable group label. */
function ModalSectionViewer({ sections }: { sections: OfferSection[] }) {
  const smrSections = sections.filter((s) => s.section_type === "smr_technology");
  const nonSmrSections = sections.filter((s) => s.section_type !== "smr_technology");

  // Default: first non-SMR section, or first SMR section
  const defaultId = nonSmrSections[0]?.id ?? smrSections[0]?.id ?? "";
  const [activeId, setActiveId] = useState<string>(defaultId);

  const activeSingle = sections.find((s) => s.id === activeId);

  return (
    <div className="flex min-h-[500px]">
      {/* Sidebar */}
      <nav className="w-64 shrink-0 overflow-y-auto border-r border-neutral-100 py-3">
        {/* Non-SMR sections */}
        {nonSmrSections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={`w-full px-4 py-3 text-left text-xs transition-colors ${
              activeId === s.id
                ? "bg-neutral-100 font-semibold text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            <span
              className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                SECTION_TYPE_COLORS[s.section_type] ?? SECTION_TYPE_COLORS.other
              }`}
            >
              {SECTION_TYPE_LABELS[s.section_type] ?? s.section_type}
            </span>
            <div className="mt-1 line-clamp-2 leading-snug">{s.title}</div>
          </button>
        ))}

        {/* SMR group header (non-clickable label) */}
        {smrSections.length > 0 && (
          <>
            <div className="mt-3 border-t border-neutral-100 px-4 pb-1 pt-3">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${SECTION_TYPE_COLORS.smr_technology}`}
              >
                {SECTION_TYPE_LABELS.smr_technology}
              </span>
              <span className="ml-2 text-[10px] text-neutral-400">
                {smrSections.length} позиц{smrSections.length === 1 ? "ия" : "ии"}
              </span>
            </div>

            {/* Individual SMR items */}
            {smrSections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`w-full px-4 py-2.5 text-left text-xs transition-colors ${
                  activeId === s.id
                    ? "bg-teal-50 font-semibold text-teal-900"
                    : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                <div className="line-clamp-3 pl-2 leading-snug">{s.title}</div>
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeSingle && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  SECTION_TYPE_COLORS[activeSingle.section_type] ?? SECTION_TYPE_COLORS.other
                }`}
              >
                {SECTION_TYPE_LABELS[activeSingle.section_type] ?? activeSingle.section_type}
              </span>
              <h4 className="text-sm font-semibold text-neutral-800">{activeSingle.title}</h4>
            </div>
            <div
              className="offer-section-preview prose prose-sm max-w-none text-sm text-neutral-700"
              dangerouslySetInnerHTML={{ __html: activeSingle.html_content }}
            />
          </>
        )}
      </div>
    </div>
  );
}


function SectionPreviewModal({
  offer,
  onClose,
}: {
  offer: OfferInfo;
  onClose: () => void;
}) {
  const [sections, setSections] = useState<OfferSection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/offers/${offer.id}/sections`)
      .then((r) => r.json())
      .then((data: { sections?: OfferSection[] }) => {
        setSections(data.sections ?? []);
      })
      .finally(() => setLoading(false));
  }, [offer.id]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    // Backdrop — click outside modal to close
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      {/* Modal panel — stop propagation so clicks inside don't close */}
      <div
        className="my-8 w-full max-w-5xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-neutral-800">
              Преглед на секции
            </h3>
            <p className="text-sm text-neutral-500">{offer.filename}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            ✕ Затвори
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-neutral-500">
            Зареждане на секции...
          </div>
        ) : sections.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-neutral-500">
            Няма намерени секции.
          </div>
        ) : (
          <ModalSectionViewer sections={sections} />
        )}
      </div>
    </div>
  );
}

function OfferUploadsSection() {
  const [offers, setOffers] = useState<OfferInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewOffer, setPreviewOffer] = useState<OfferInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/offers");
      const data = (await res.json()) as { offers?: OfferInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setOffers(data.offers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при зареждане");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

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
      const res = await fetch("/api/admin/offers", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        sectionCount?: number;
        sectionTypes?: { type: string; title: string }[];
      };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const count = data.sectionCount ?? 0;
      const types = (data.sectionTypes ?? [])
        .map((s) => SECTION_TYPE_LABELS[s.type] ?? s.type)
        .join(", ");
      setSuccessMsg(`Офертата е качена и анализирана. Намерени ${count} секции: ${types}`);
      await fetchOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при качване");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Изтрий офертата "${name}" и всички нейни секции?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/offers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      await fetchOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при изтриване");
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload area */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleUpload(file);
        }}
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-neutral-300 bg-white hover:border-neutral-400"
        }`}
      >
        <div className="text-2xl mb-2">📄</div>
        <p className="text-sm font-medium text-neutral-700">
          Плъзнете пълна оферта (.docx) тук
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          AI ще извлече увод, СМР технологии, организация на екипа и комуникация — с пълно форматиране и снимки
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Анализира се..." : "Изберете файл"}
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
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {successMsg && (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">{successMsg}</p>
      )}

      {/* Offers list */}
      <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-6 py-4">
          <h3 className="text-base font-semibold text-neutral-800">Качени оферти</h3>
          <p className="mt-0.5 text-sm text-neutral-500">
            Секциите от тези оферти се използват автоматично при AI генериране (RAG).
          </p>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-500">Зареждане...</div>
        ) : offers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-500">
            Няма качени оферти. Качете .docx файл по-горе.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {offers.map((offer) => (
              <div key={offer.id} className="flex items-center justify-between px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate text-sm font-medium text-neutral-800">
                      {offer.filename}
                    </span>
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {offer.section_count} секции
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {formatDate(offer.created_at)} &middot; {formatBytes(offer.file_size)}
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 gap-2">
                  <button
                    onClick={() => setPreviewOffer(offer)}
                    className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                  >
                    Преглед
                  </button>
                  <button
                    onClick={() => handleDelete(offer.id, offer.filename)}
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

      {/* Preview modal */}
      {previewOffer && (
        <SectionPreviewModal
          offer={previewOffer}
          onClose={() => setPreviewOffer(null)}
        />
      )}
    </div>
  );
}

const REQUIRED_PIN = process.env.NEXT_PUBLIC_TEMPLATES_PIN?.trim() || null;
const PIN_NOT_CONFIGURED = !REQUIRED_PIN;

export default function AdminTemplatesPage() {
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "offers">("templates");

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
              Администрация
            </h1>
            <p className="mt-1 max-w-xl text-sm text-neutral-600">
              Управление на шаблони и пълни оферти за AI обучение.
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

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {!authorized ? (
          <section className="mx-auto max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-neutral-800">
              Достъп до администрацията
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
                  Въведете ПИН, за да управлявате шаблоните и офертите.
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
            {/* Tab navigation */}
            <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setActiveTab("templates")}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "templates"
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                📋 Шаблони
              </button>
              <button
                onClick={() => setActiveTab("offers")}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "offers"
                    ? "bg-blue-600 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                🧠 Пълни Оферти (RAG)
              </button>
            </div>

            {activeTab === "templates" ? (
              <div className="space-y-10">
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
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-neutral-800">
                    Пълни Оферти — Самообучаване
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    Качвайте готови Технически предложения. AI извлича секциите с пълно форматиране (текст, снимки, таблици) и ги използва като примери при генерация на нови оферти. С всяка нова оферта системата се подобрява.
                  </p>
                </div>
                <OfferUploadsSection />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

