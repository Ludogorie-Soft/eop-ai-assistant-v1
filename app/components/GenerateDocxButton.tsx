"use client";

import { useState } from "react";
import type { SmrResult } from "./KssSmrSection";

interface GenerateDocxButtonProps {
  introductionText: string;
  rawText?: string;
  smrResults?: SmrResult[];
  teamOrganizationText?: string;
  onAfterExport?: () => void;
}

function stripHtml(html: string): string {
  if (!html) return '';
  if (!html.includes('<')) return html;
  // Preserve paragraph structure: block elements → double newlines, <br> → single newline
  return html
    .replace(/<\/?(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function GenerateDocxButton({
  introductionText,
  rawText,
  smrResults = [],
  teamOrganizationText = "",
  onAfterExport,
}: GenerateDocxButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plainIntroduction = stripHtml(introductionText);
  const plainTeamOrganization = stripHtml(teamOrganizationText ?? '');
  const hasIntroduction = plainIntroduction.trim().length > 0;
  const hasSmr = smrResults.length > 0;

  const handleGenerate = async () => {
    if (!hasIntroduction && !hasSmr) {
      setError(
        "Въведете/генерирайте увод и/или генерирайте текстове за КСС за експорт.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          introductionText: hasIntroduction ? plainIntroduction : undefined,
          rawText: rawText ?? "",
          smrResults: hasSmr ? smrResults : undefined,
          teamOrganizationText: plainTeamOrganization.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let data: { error?: string } = {};
        if (text) {
          try {
            data = JSON.parse(text) as { error?: string };
          } catch {
            data = {};
          }
        }
        throw new Error(data.error ?? "Failed to generate DOCX");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch =
        disposition?.match(/filename\*?=(?:UTF-8'')([^;]+)/i) ??
        disposition?.match(/filename=["']?([^"';]+)["']?/i);
      const filename = filenameMatch
        ? decodeURIComponent(filenameMatch[1].trim())
        : "tender_technical.docx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      onAfterExport?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Грешка при генериране на DOCX",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-800">Експорт</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Генерирайте DOCX: с увод (ако има), после текстове за КСС (ако има).
        Можете да експортнете само увод, само КСС или и двете.
      </p>
      <div className="mt-3">
        <button
          onClick={handleGenerate}
          disabled={loading || (!hasIntroduction && !hasSmr)}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Генериране..." : "Генерирай DOCX"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
