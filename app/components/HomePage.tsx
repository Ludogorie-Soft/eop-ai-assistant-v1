'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TenderSource } from './TenderSource';
import { RawExtractedText } from './RawExtractedText';
import { Introduction } from './Introduction';
import { KssSmrSection, type SmrResult } from './KssSmrSection';
import { GenerateDocxButton } from './GenerateDocxButton';

export function HomePage() {
  const [rawText, setRawText] = useState('');
  const [introductionText, setIntroductionText] = useState('');
  const [smrResults, setSmrResults] = useState<SmrResult[]>([]);

  const handleRawTextUpdate = (text: string) => {
    setRawText(text);
  };

  const handleIntroductionUpdate = (text: string) => {
    setIntroductionText(text);
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold text-neutral-850">
              Tender Technical Generator
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              MVP v1 – Увод, CAIS, файлове, AI генериране, DOCX експорт
            </p>
          </div>
          <Link
            href="/admin/templates"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Шаблони СМР
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <TenderSource onRawTextUpdate={handleRawTextUpdate} rawText={rawText} />
        <RawExtractedText rawText={rawText} />
        <Introduction
          rawText={rawText}
          introductionText={introductionText}
          onIntroductionUpdate={handleIntroductionUpdate}
        />
        <KssSmrSection
          smrResults={smrResults}
          onSmrResultsUpdate={setSmrResults}
        />
        <GenerateDocxButton
          introductionText={introductionText}
          rawText={rawText}
          smrResults={smrResults}
        />
      </main>
    </div>
  );
}
