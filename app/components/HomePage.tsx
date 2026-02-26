"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { TenderSource } from "./TenderSource";
import { RawExtractedText } from "./RawExtractedText";
import { Introduction } from "./Introduction";
import { KssSmrSection, type SmrResult } from "./KssSmrSection";
import { GenerateDocxButton } from "./GenerateDocxButton";

interface HomePageProps {
  tenderId: string;
  initialName?: string;
  initialRawText?: string;
  initialIntroductionText?: string;
  initialSmrResults?: unknown[];
}

export function HomePage({
  tenderId,
  initialName = '',
  initialRawText = '',
  initialIntroductionText = '',
  initialSmrResults = [],
}: HomePageProps) {
  const [tenderName, setTenderName] = useState(initialName);
  const [rawText, setRawText] = useState(initialRawText);
  const [introductionText, setIntroductionText] = useState(initialIntroductionText);
  const [smrResults, setSmrResults] = useState<SmrResult[]>(
    initialSmrResults as SmrResult[]
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const saveTender = useCallback(
    async (fields: Record<string, unknown>) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/tenders/${tenderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        setLastSaved(
          new Date().toLocaleTimeString('bg-BG', {
            hour: '2-digit',
            minute: '2-digit',
          })
        );
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Грешка при запазване');
      } finally {
        setSaving(false);
      }
    },
    [tenderId]
  );

  const handleNameBlur = () => {
    if (tenderName !== initialName) {
      saveTender({ name: tenderName });
    }
  };

  const handleAfterDocxExport = useCallback(() => {
    saveTender({
      name: tenderName,
      introduction_text: introductionText,
      raw_text: rawText,
      smr_results: smrResults,
    });
  }, [saveTender, tenderName, introductionText, rawText, smrResults]);

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="shrink-0 text-neutral-400 hover:text-neutral-600"
                title="Към списъка"
              >
                &larr;
              </Link>
              <h1 className="text-xl font-semibold text-neutral-800">
                Tender Technical Generator
              </h1>
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              v1 – Увод, КСС, AI генериране, DOCX експорт
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {saving && (
              <span className="text-xs text-neutral-400">Запазване...</span>
            )}
            {lastSaved && !saving && (
              <span className="text-xs text-neutral-400">
                Запазено в {lastSaved}
              </span>
            )}
            <Link
              href="/admin/templates"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Шаблони СМР
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {saveError && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </p>
        )}

        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-neutral-700">
            Име на поръчката
          </label>
          <input
            type="text"
            value={tenderName}
            onChange={(e) => setTenderName(e.target.value)}
            onBlur={handleNameBlur}
            placeholder="Въведете име на обществената поръчка"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
          />
        </section>

        <TenderSource onRawTextUpdate={setRawText} rawText={rawText} />
        <RawExtractedText rawText={rawText} />
        <Introduction
          rawText={rawText}
          introductionText={introductionText}
          onIntroductionUpdate={setIntroductionText}
        />
        <KssSmrSection
          smrResults={smrResults}
          onSmrResultsUpdate={setSmrResults}
        />
        <GenerateDocxButton
          introductionText={introductionText}
          rawText={rawText}
          smrResults={smrResults}
          onAfterExport={handleAfterDocxExport}
        />
      </main>
    </div>
  );
}
