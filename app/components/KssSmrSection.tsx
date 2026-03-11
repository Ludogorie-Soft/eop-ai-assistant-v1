"use client";

import { useState, useRef } from "react";

export type SmrResult = {
  kssCode: string;
  kssName: string;
  matchedTitle: string | null;
  text: string;
  confidence: number;
  htmlBody?: string;
};

export type ValidationResultMap = Record<
  string,
  {
    reference: string;
    status: "valid" | "withdrawn" | "under_review" | "replaced" | "unknown";
    statusCode?: string;
    currentTitle?: string;
    replacement?: string;
    note?: string;
    lastChecked: string;
    source: string;
    inlineDescription?: string;
    titleMismatch?: boolean;
  }
>;

interface KssSmrSectionProps {
  smrResults: SmrResult[];
  onSmrResultsUpdate: (results: SmrResult[]) => void;
  onValidationResults?: (results: ValidationResultMap) => void;
}

const STATUS_ORDER: ValidationResultMap[string]["status"][] = [
  "withdrawn", "replaced", "under_review", "unknown", "valid",
];

const STATUS_LABEL: Record<ValidationResultMap[string]["status"], string> = {
  withdrawn: "Оттеглен",
  replaced: "За замяна",
  under_review: "В преразглеждане",
  unknown: "Неизвестен",
  valid: "Валиден",
};

const STATUS_CLASSES: Record<ValidationResultMap[string]["status"], string> = {
  withdrawn: "bg-red-100 text-red-800",
  replaced: "bg-orange-100 text-orange-800",
  under_review: "bg-amber-100 text-amber-800",
  unknown: "bg-neutral-100 text-neutral-600",
  valid: "bg-green-100 text-green-800",
};

function ValidationDetailsTable({ results }: { results: ValidationResultMap }) {
  const entries = Object.values(results).sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status);
    const bi = STATUS_ORDER.indexOf(b.status);
    if (ai !== bi) return ai - bi;
    return a.reference.localeCompare(b.reference, "bg");
  });

  return (
    <div className="mt-3 max-h-80 overflow-auto rounded border border-amber-200">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-amber-100 text-amber-900">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Стандарт</th>
            <th className="px-2 py-1.5 text-left font-medium">Статус</th>
            <th className="px-2 py-1.5 text-left font-medium">Код</th>
            <th className="px-2 py-1.5 text-left font-medium">Официално заглавие / Бележка</th>
            <th className="px-2 py-1.5 text-left font-medium">Описание в текста</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-amber-100">
          {entries.map((r) => (
            <tr key={r.reference} className="bg-white hover:bg-amber-50">
              <td className="px-2 py-1.5 font-mono font-medium text-neutral-800 whitespace-nowrap">
                {r.reference}
              </td>
              <td className="px-2 py-1.5">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="px-2 py-1.5 text-neutral-500 whitespace-nowrap">
                {r.statusCode ?? "—"}
              </td>
              <td className="px-2 py-1.5 text-neutral-600">
                {r.currentTitle ?? r.note ?? "—"}
              </td>
              <td className="px-2 py-1.5">
                {r.inlineDescription ? (
                  <span className={r.titleMismatch ? "font-medium text-red-700" : "text-neutral-600"}>
                    {r.titleMismatch && <span title="Описанието може да не съответства на стандарта">⚠️ </span>}
                    {r.inlineDescription}
                  </span>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatResultsAsText(results: SmrResult[]): string {
  if (!results.length) return "";
  return results
    .map(
      (r) =>
        `${r.kssCode} – ${r.kssName} (увереност: ${r.confidence}%)\n${r.text}`,
    )
    .join("\n\n---\n\n");
}

export function KssSmrSection({
  smrResults,
  onSmrResultsUpdate,
  onValidationResults,
}: KssSmrSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationSummary, setValidationSummary] = useState<{
    total: number;
    valid: number;
    withdrawn: number;
    underReview: number;
    replaced: number;
    unknown: number;
  } | null>(null);
  const [validationDetails, setValidationDetails] = useState<ValidationResultMap | null>(null);
  const [showValidationDetails, setShowValidationDetails] = useState(false);
  const kssInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    const fileList =
      kssInputRef.current?.files ??
      (document.querySelector('input[name="kssFile"]') as HTMLInputElement)
        ?.files;
    const kssFiles = fileList ? Array.from(fileList) : [];

    if (kssFiles.length === 0) {
      setError("Изберете поне един KSS Excel файл.");
      return;
    }

    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const formData = new FormData();
      for (const file of kssFiles) {
        formData.append("kssFile", file);
      }

      const res = await fetch("/api/generate-kss-smr", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: SmrResult[];
        error?: string;
        warning?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? "Грешка при генериране");
      }
      onSmrResultsUpdate(data.results ?? []);
      if (data.warning) setWarning(data.warning);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Грешка при генериране на текстове СМР",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleValidateStandards = async () => {
    if (smrResults.length === 0) return;
    setValidating(true);
    setValidationSummary(null);
    try {
      const res = await fetch("/api/validate-standards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smrResults }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Грешка при валидация");
      setValidationSummary(data.summary);
      setValidationDetails(data.validations);
      onValidationResults?.(data.validations);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Грешка при валидация на стандарти"
      );
    } finally {
      setValidating(false);
    }
  };

  const displayText = formatResultsAsText(smrResults);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">
        Текстове за КСС (от KSS + Шаблони)
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Можете да качите един или няколко KSS Excel файла. Натиснете „Генерирай
        текстове СМР за КСС“. Резултатът се показва по-долу и се включва в DOCX
        при експорт.
      </p>

      <div className="mt-3">
        <label className="block text-sm font-medium text-neutral-700">
          KSS Excel (един или повече файла)
        </label>
        <input
          ref={kssInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          name="kssFile"
          multiple
          className="mt-1 block w-full text-sm text-neutral-600 file:mr-2 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-neutral-700"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Генериране..." : "Генерирай текстове СМР за КСС"}
        </button>
        {smrResults.length > 0 && (
          <button
            onClick={handleValidateStandards}
            disabled={validating}
            className="rounded-md border border-amber-500 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {validating ? "Валидиране..." : "Валидирай стандарти"}
          </button>
        )}
        {smrResults.length > 0 && (
          <button
            onClick={async () => {
              await fetch("/api/clear-standards-cache", { method: "POST" });
            }}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            title="Изчисти кеша за стандарти — следващата валидация ще провери всичко наново"
          >
            Изчисти кеш
          </button>
        )}
      </div>

      {validationSummary && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="font-medium text-amber-900">
                Стандарти: {validationSummary.total} намерени
              </span>
              <span className="ml-3 text-green-700">{validationSummary.valid} валидни</span>
              {validationSummary.withdrawn > 0 && (
                <span className="ml-3 font-semibold text-red-700">
                  {validationSummary.withdrawn} оттеглени
                </span>
              )}
              {validationSummary.underReview > 0 && (
                <span className="ml-3 text-amber-700">
                  {validationSummary.underReview} в преразглеждане
                </span>
              )}
              {validationSummary.replaced > 0 && (
                <span className="ml-3 text-orange-700">
                  {validationSummary.replaced} заменени
                </span>
              )}
              {validationSummary.unknown > 0 && (
                <span className="ml-3 text-neutral-500">
                  {validationSummary.unknown} неизвестни
                </span>
              )}
            </div>
            {validationDetails && (
              <button
                onClick={() => setShowValidationDetails((v) => !v)}
                className="text-xs text-amber-800 underline hover:no-underline"
              >
                {showValidationDetails ? "Скрий детайли" : "Виж всички стандарти"}
              </button>
            )}
          </div>

          {showValidationDetails && validationDetails && (
            <ValidationDetailsTable results={validationDetails} />
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {warning && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {warning}
        </p>
      )}

      <textarea
        readOnly
        value={displayText}
        placeholder="Текстовете за КСС ще се появят след генериране."
        className="mt-3 h-64 w-full resize-y rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 placeholder-neutral-400"
        style={{ textAlign: "justify" }}
      />
    </section>
  );
}
