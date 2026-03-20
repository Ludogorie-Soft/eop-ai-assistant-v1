"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { TenderSource } from "./TenderSource";
import { Introduction } from "./Introduction";
import { TeamOrganization } from "./TeamOrganization";
import { KssSmrSection, type SmrResult, type ValidationResultMap } from "./KssSmrSection";
import { Communication } from "./Communication";
import { GenerateDocxButton } from "./GenerateDocxButton";

interface HomePageProps {
  tenderId: string;
  initialName?: string;
  initialRawText?: string;
  initialIntroductionText?: string;
  initialSmrResults?: unknown[];
  initialTeamOrganizationText?: string;
  initialCommunicationText?: string;
}

const NAV_SECTIONS = [
  { id: "source", label: "Източник" },
  { id: "introduction", label: "Увод" },
  { id: "kss-smr", label: "КСС / СМР" },
  { id: "team", label: "Екип" },
  { id: "communication", label: "Комуникация" },
  { id: "export", label: "Експорт" },
];

export function HomePage({
  tenderId,
  initialName = "",
  initialRawText = "",
  initialIntroductionText = "",
  initialSmrResults = [],
  initialTeamOrganizationText = "",
  initialCommunicationText = "",
}: HomePageProps) {
  const [tenderName, setTenderName] = useState(initialName);
  const [rawText, setRawText] = useState(initialRawText);
  const [introductionText, setIntroductionText] = useState(initialIntroductionText);
  const [teamOrganizationText, setTeamOrganizationText] = useState(initialTeamOrganizationText);
  const [communicationText, setCommunicationText] = useState(initialCommunicationText);
  const [smrResults, setSmrResults] = useState<SmrResult[]>(initialSmrResults as SmrResult[]);
  const [filesProcessing, setFilesProcessing] = useState(false);
  const [validationResults, setValidationResults] = useState<ValidationResultMap>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("source");

  const mainRef = useRef<HTMLElement>(null);

  // Track active section based on scroll position
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const handleScroll = () => {
      let current = NAV_SECTIONS[0].id;
      for (const { id } of NAV_SECTIONS) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 100) current = id;
        }
      }
      setActiveSection(current);
    };

    main.addEventListener("scroll", handleScroll, { passive: true });
    return () => main.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el && mainRef.current) {
      const top = el.offsetTop - 24;
      mainRef.current.scrollTo({ top, behavior: "smooth" });
    }
  };

  const sectionHasContent: Record<string, boolean> = {
    source: !!rawText,
    introduction: !!introductionText.trim(),
    "kss-smr": smrResults.length > 0,
    team: !!teamOrganizationText.trim(),
    communication: !!communicationText.trim(),
    export: false,
  };

  const saveTender = useCallback(
    async (fields: Record<string, unknown>) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/tenders/${tenderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Save failed");
        setLastSaved(
          new Date().toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" }),
        );
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Грешка при запазване");
      } finally {
        setSaving(false);
      }
    },
    [tenderId],
  );

  const handleNameBlur = () => {
    if (tenderName !== initialName) saveTender({ name: tenderName });
  };

  const handleAfterDocxExport = useCallback(() => {
    saveTender({
      name: tenderName,
      introduction_text: introductionText,
      team_organization_text: teamOrganizationText,
      communication_text: communicationText,
      raw_text: rawText,
      smr_results: smrResults,
    });
  }, [saveTender, tenderName, introductionText, teamOrganizationText, communicationText, rawText, smrResults]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
        {/* App header */}
        <div className="border-b border-neutral-200 px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-medium text-neutral-500 hover:text-neutral-800"
          >
            <span>←</span>
            <span>Всички поръчки</span>
          </Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Tender Generator
          </p>
        </div>

        {/* Section nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                activeSection === id
                  ? "bg-white font-medium text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  sectionHasContent[id] ? "bg-emerald-500" : "bg-neutral-300"
                }`}
              />
              {label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-neutral-200 px-4 py-3 space-y-2">
          {saving && <p className="text-xs text-neutral-400">Запазване...</p>}
          {lastSaved && !saving && (
            <p className="text-xs text-neutral-400">Запазено в {lastSaved}</p>
          )}
          <Link
            href="/admin/templates"
            className="block rounded-md border border-neutral-200 px-3 py-1.5 text-center text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Шаблони
          </Link>
        </div>
      </aside>

      {/* Document canvas */}
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-12 pb-32">
          {/* Document title */}
          <div className="border-b border-neutral-100 py-10">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-400">
              Име на поръчката
            </label>
            <input
              type="text"
              value={tenderName}
              onChange={(e) => setTenderName(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="Въведете заглавие..."
              className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-2xl font-bold text-neutral-900 placeholder-neutral-300 transition-colors hover:border-neutral-300 focus:border-neutral-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200"
            />
            <p className="mt-2 text-sm text-neutral-400">
              Tender Technical Generator · v1
            </p>
          </div>

          {saveError && (
            <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </p>
          )}

          <div id="source">
            <TenderSource
              onRawTextUpdate={setRawText}
              rawText={rawText}
              onLoadingChange={setFilesProcessing}
            />
          </div>

          <div id="introduction">
            <Introduction
              rawText={rawText}
              introductionText={introductionText}
              onIntroductionUpdate={setIntroductionText}
              isFilesProcessing={filesProcessing}
            />
          </div>

          <div id="kss-smr">
            <KssSmrSection
              smrResults={smrResults}
              onSmrResultsUpdate={setSmrResults}
              onValidationResults={setValidationResults}
            />
          </div>

          <div id="team">
            <TeamOrganization
              rawText={rawText}
              teamOrganizationText={teamOrganizationText}
              onTeamOrganizationUpdate={setTeamOrganizationText}
              smrResults={smrResults}
            />
          </div>

          <div id="communication">
            <Communication
              rawText={rawText}
              communicationText={communicationText}
              onCommunicationUpdate={setCommunicationText}
              smrResults={smrResults}
            />
          </div>

          <div id="export">
            <GenerateDocxButton
              introductionText={introductionText}
              rawText={rawText}
              smrResults={smrResults}
              teamOrganizationText={teamOrganizationText}
              communicationText={communicationText}
              onAfterExport={handleAfterDocxExport}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
