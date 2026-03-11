/**
 * Validate Bulgarian standards and regulations against external sources.
 * - Standards (БДС/EN/ISO): checked against bds-bg.org
 * - Regulations (Наредба/Закон): checked against known status map (MVP)
 * Server-side only.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { ExtractedReference } from "./standardsExtractor";

const execFileAsync = promisify(execFile);

export type ValidationStatus =
  | "valid"
  | "withdrawn"
  | "under_review"
  | "replaced"
  | "unknown";

export type ValidationResult = {
  reference: string;
  status: ValidationStatus;
  statusCode?: string;
  currentTitle?: string;
  replacement?: string;
  note?: string;
  lastChecked: string;
  source: string;
  /** Inline description found in the source text, e.g. "за изпитвания на зърнометричен състав" */
  inlineDescription?: string;
  /** True when the inline description appears unrelated to the official title from bds-bg.org */
  titleMismatch?: boolean;
};

// ---------------------------------------------------------------------------
// BDS status code mapping (ISO stage codes used by bds-bg.org)
// ---------------------------------------------------------------------------
const BDS_STATUS_MAP: Record<string, ValidationStatus> = {
  "10.99": "valid",     // New project approved
  "20.00": "valid",     // Registered
  "40.60": "valid",     // Close of voting
  "60.60": "valid",     // Published standard
  "90.20": "under_review", // Under systematic review
  "90.60": "under_review", // Close of review
  "90.92": "replaced",  // To be revised
  "90.93": "valid",     // Confirmed
  "95.99": "withdrawn", // Withdrawal of standard
};

/** Delay helper for rate limiting */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compare an inline description from the source text against the official
 * title from bds-bg.org. Returns true if there is a likely mismatch (the
 * description shares very few meaningful words with the title).
 *
 * Uses simple word-overlap: tokenise both strings (Bulgarian + Latin words ≥4
 * chars, case-insensitive), count how many description words appear anywhere
 * in the title. If overlap < 1 word we flag a mismatch.
 */
function hasTitleMismatch(inlineDesc: string, officialTitle: string): boolean {
  const tokenize = (s: string) =>
    s.toLowerCase().match(/[а-яa-z]{4,}/gi) ?? [];
  const descWords = tokenize(inlineDesc);
  if (descWords.length === 0) return false;
  const titleLower = officialTitle.toLowerCase();
  const matches = descWords.filter((w) => titleLower.includes(w));
  return matches.length === 0;
}

/**
 * Check a single standard against bds-bg.org.
 * Uses keyword search which returns server-rendered HTML (no JS required).
 */
async function checkBdsStandard(
  ref: ExtractedReference
): Promise<ValidationResult> {
  const now = new Date().toISOString();
  const baseResult: ValidationResult = {
    reference: ref.normalized,
    status: "unknown",
    lastChecked: now,
    source: "bds-bg.org",
  };

  try {
    const searchUrl =
      `https://bds-bg.org/bg/project/list?keywords=${encodeURIComponent(ref.searchTerm)}` +
      `&status%5B0%5D=IN_DEVELOPMENT&status%5B1%5D=PUBLISHED&status%5B2%5D=WITHDRAWN` +
      `&operatorCommittee=1&operatorStdType=3&listMode=DEFAULT`;

    // Use curl instead of fetch — bds-bg.org is very slow (~15-30s) and
    // Node's fetch often times out before curl does.
    const { stdout: html } = await execFileAsync("curl", [
      "-s", "-L",
      "--max-time", "45",
      "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      searchUrl,
    ]);

    if (!html || html.length < 100) {
      console.log(`[checkBds] ${ref.normalized} → empty response`);
      return { ...baseResult, note: "Празен отговор от bds-bg.org" };
    }

    console.log(`[checkBds] ${ref.normalized} (search: "${ref.searchTerm}") → ${html.length} bytes`);

    // Find the search term inside an <h4> tag (actual result cards),
    // not in navigation/header URLs where the keyword also appears.
    const searchNum = ref.searchTerm;
    let resultIdx = -1;
    {
      let pos = 0;
      while (pos < html.length) {
        const i = html.indexOf(searchNum, pos);
        if (i === -1) break;
        // Check if this occurrence is inside an <h4> — look backwards for <h4
        const preceding = html.slice(Math.max(0, i - 200), i);
        if (preceding.includes("<h4") && !preceding.includes("</h4>")) {
          resultIdx = i;
          break;
        }
        pos = i + 1;
      }
    }

    if (resultIdx === -1) {
      console.log(`[checkBds] ${ref.normalized} → searchTerm "${searchNum}" NOT FOUND in results`);
      return { ...baseResult, note: "Не е намерен в bds-bg.org" };
    }

    // Extract the full standard title from the <h4> containing the match
    const h4Start = html.lastIndexOf("<h4", resultIdx);
    const h4End = html.indexOf("</h4>", resultIdx);
    let currentTitle: string | undefined;
    if (h4Start >= 0 && h4End > h4Start) {
      currentTitle = html
        .slice(h4Start, h4End)
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, "")
        .trim();
    }

    // Extract status code from the <span class="label ..."> after the result
    // The card structure has status ~500-1500 chars after the <h4>
    const afterResult = html.slice(resultIdx, resultIdx + 2000);
    const statusMatch = afterResult.match(
      /<span\s+class="label[^"]*"[^>]*>(\d+\.\d+)<\/span>/
    );
    const statusCode = statusMatch?.[1];

    if (!statusCode) {
      return { ...baseResult, currentTitle, inlineDescription: ref.inlineDescription, note: "Статус кодът не е намерен" };
    }

    const status = BDS_STATUS_MAP[statusCode] ?? "unknown";

    const titleMismatch =
      ref.inlineDescription && currentTitle
        ? hasTitleMismatch(ref.inlineDescription, currentTitle)
        : undefined;

    return {
      ...baseResult,
      status,
      statusCode,
      currentTitle,
      inlineDescription: ref.inlineDescription,
      titleMismatch: titleMismatch || undefined,
      note:
        status === "withdrawn"
          ? "Стандартът е оттеглен"
          : status === "under_review"
            ? "Стандартът е в процес на преразглеждане"
            : status === "replaced"
              ? "Стандартът предстои да бъде заменен"
              : undefined,
    };
  } catch (err) {
    return {
      ...baseResult,
      note: `Грешка: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/**
 * Check a regulation reference.
 * MVP: returns "unknown" with a note to check manually.
 * lex.bg requires JavaScript rendering — not feasible for server-side scraping.
 */
function checkRegulation(ref: ExtractedReference): ValidationResult {
  return {
    reference: ref.normalized,
    status: "unknown",
    lastChecked: new Date().toISOString(),
    source: "manual",
    note: "Наредбите изискват ръчна проверка в lex.bg",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a batch of references.
 * Uses cache where available, fetches from bds-bg.org for uncached/stale standards.
 * Rate-limited to 1 request per 600ms to avoid overloading bds-bg.org.
 */
export async function validateReferences(
  refs: ExtractedReference[],
  existingCache: Map<string, ValidationResult> = new Map()
): Promise<Map<string, ValidationResult>> {
  const results = new Map(existingCache);
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
  const now = Date.now();

  // Split into cached (fresh) vs needs-check
  const toCheck: ExtractedReference[] = [];
  for (const ref of refs) {
    const cached = results.get(ref.normalized);
    if (cached) {
      const age = now - new Date(cached.lastChecked).getTime();
      // Don't cache "unknown" results from failed lookups — always re-check
      if (age < CACHE_TTL_MS && cached.status !== "unknown") continue;
    }
    toCheck.push(ref);
  }

  console.log(
    `[standardsValidator] ${refs.length} refs total, ${toCheck.length} need checking`
  );

  // Separate regulations (instant) from standards (need HTTP)
  const regulations = toCheck.filter((r) => r.type !== "standard");
  const standards = toCheck.filter((r) => r.type === "standard");

  for (const ref of regulations) {
    results.set(ref.normalized, checkRegulation(ref));
  }

  // Process standards in batches of 5 concurrent requests
  const BATCH_SIZE = 5;
  for (let i = 0; i < standards.length; i += BATCH_SIZE) {
    const batch = standards.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();
    console.log(
      `[standardsValidator] Checking ${i + 1}-${Math.min(i + BATCH_SIZE, standards.length)} of ${standards.length} standards...`
    );
    const batchResults = await Promise.all(batch.map((ref) => checkBdsStandard(ref)));
    for (let j = 0; j < batch.length; j++) {
      results.set(batch[j].normalized, batchResults[j]);
    }
    const statuses = batchResults.map((r) => `${r.statusCode ?? "?"}: ${r.status}`).join(", ");
    console.log(
      `[standardsValidator] Batch done in ${((Date.now() - batchStart) / 1000).toFixed(1)}s → ${statuses}`
    );
    // Rate limit between batches (not after the last one)
    if (i + BATCH_SIZE < standards.length) {
      await delay(800);
    }
  }

  return results;
}
