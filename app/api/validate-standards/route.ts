/**
 * Standards & regulations validation API.
 * POST: accepts smrResults[], extracts references, validates against bds-bg.org,
 * returns validation results with status for each reference.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractReferences } from "@/lib/standardsExtractor";
import { validateReferences, type ValidationResult } from "@/lib/standardsValidator";
import { loadCache, saveCache } from "@/lib/standardsCache";

type SmrInput = {
  text?: string;
  htmlBody?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const smrResults: SmrInput[] = body.smrResults ?? [];

    if (smrResults.length === 0) {
      return NextResponse.json(
        { error: "Няма СМР текстове за валидация." },
        { status: 400 }
      );
    }

    // 1. Extract all references from all SMR results
    const allRefs = new Map<string, ReturnType<typeof extractReferences>[number]>();
    for (const r of smrResults) {
      const text = r.htmlBody || r.text || "";
      const refs = extractReferences(text);
      for (const ref of refs) {
        if (!allRefs.has(ref.normalized)) {
          allRefs.set(ref.normalized, ref);
        }
      }
    }

    const uniqueRefs = [...allRefs.values()];
    console.log(
      `[validate-standards] Extracted ${uniqueRefs.length} unique references from ${smrResults.length} SMR results`
    );

    // 2. Load existing cache
    const cache = await loadCache();

    // 3. Validate (fetches from bds-bg.org for uncached/stale)
    const results = await validateReferences(uniqueRefs, cache);

    // 4. Save updated cache
    await saveCache(results);

    // 5. Build response
    const validations: Record<string, ValidationResult> = {};
    let valid = 0,
      withdrawn = 0,
      underReview = 0,
      replaced = 0,
      unknown = 0;

    for (const ref of uniqueRefs) {
      const result = results.get(ref.normalized);
      if (!result) continue;
      validations[ref.normalized] = result;
      switch (result.status) {
        case "valid": valid++; break;
        case "withdrawn": withdrawn++; break;
        case "under_review": underReview++; break;
        case "replaced": replaced++; break;
        default: unknown++; break;
      }
    }

    return NextResponse.json({
      validations,
      summary: {
        total: uniqueRefs.length,
        valid,
        withdrawn,
        underReview,
        replaced,
        unknown,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Validation failed";
    console.error("[validate-standards] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
