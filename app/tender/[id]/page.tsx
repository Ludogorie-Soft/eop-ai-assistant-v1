"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { HomePage } from "@/app/components/HomePage";

interface TenderData {
  id: string;
  name: string;
  introduction_text: string;
  team_organization_text: string;
  raw_text: string;
  smr_results: unknown[];
}

export default function TenderDetailPage() {
  const params = useParams<{ id: string }>();
  const tenderId = params.id;

  const [tender, setTender] = useState<TenderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenderId) return;
    (async () => {
      try {
        const res = await fetch(`/api/tenders/${tenderId}`);
        const data = (await res.json()) as {
          tender?: TenderData;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setTender(data.tender ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Грешка при зареждане");
      } finally {
        setLoading(false);
      }
    })();
  }, [tenderId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100">
        <p className="text-sm text-neutral-500">Зареждане...</p>
      </div>
    );
  }

  if (error || !tender) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100">
        <div className="text-center">
          <p className="text-sm text-red-600">
            {error ?? "Поръчката не е намерена."}
          </p>
          <a
            href="/"
            className="mt-2 inline-block text-sm text-neutral-600 hover:underline"
          >
            Към списъка
          </a>
        </div>
      </div>
    );
  }

  return (
    <HomePage
      tenderId={tender.id}
      initialName={tender.name}
      initialRawText={tender.raw_text}
      initialIntroductionText={tender.introduction_text}
       initialTeamOrganizationText={tender.team_organization_text}
      initialSmrResults={tender.smr_results}
    />
  );
}
