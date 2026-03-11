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
  /** Published successor standard (60.60/90.93) found on bds-bg.org for replaced standards */
  replacedBy?: string;
  /** Draft/work-in-progress successor (10.99/20.00/40.60 or "pr" prefix) for replaced standards */
  draftVersion?: string;
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
 * Check whether a position in the HTML is a "clean" match for searchTerm inside an <h4>:
 *   1. char before is not a digit  (prevents "16933-1" matching "933-1")
 *   2. char after  is not a digit  (prevents "12697-23" matching "12697-2", "14230" matching "1423")
 *   3. not preceded by "digit + space/dash"  (prevents "301 933-1" matching "933-1")
 *   4. occurs inside an <h4> tag (not in nav URLs)
 */
function isCleanH4Match(html: string, i: number, searchTerm: string): boolean {
  const charBefore1 = i > 0 ? html[i - 1] : "";
  const charBefore2 = i > 1 ? html[i - 2] : "";
  const charAfter   = html[i + searchTerm.length] ?? "";

  if (/\d/.test(charBefore1)) return false;
  if (/\d/.test(charAfter))   return false;
  // digit + whitespace/separator immediately before (e.g. "301 933-1")
  if (/\d/.test(charBefore2) && /[\s\-]/.test(charBefore1)) return false;

  const preceding = html.slice(Math.max(0, i - 200), i);
  return preceding.includes("<h4") && !preceding.includes("</h4>");
}

/**
 * Extract all (title, statusCode) pairs from the result cards in bds-bg.org HTML
 * that contain `searchTerm` inside an <h4> tag.
 */
function extractResultCards(
  html: string,
  searchTerm: string
): Array<{ title: string; statusCode: string }> {
  const cards: Array<{ title: string; statusCode: string }> = [];
  let pos = 0;
  while (pos < html.length) {
    const i = html.indexOf(searchTerm, pos);
    if (i === -1) break;
    if (!isCleanH4Match(html, i, searchTerm)) { pos = i + 1; continue; }
    const h4Start = html.lastIndexOf("<h4", i);
    const h4End = html.indexOf("</h4>", i);
    if (h4Start < 0 || h4End <= h4Start) { pos = i + 1; continue; }
    const title = html.slice(h4Start, h4End).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
    const afterResult = html.slice(i, i + 2000);
    const statusMatch = afterResult.match(/<span\s+class="label[^"]*"[^>]*>(\d+\.\d+)<\/span>/);
    if (statusMatch) {
      cards.push({ title, statusCode: statusMatch[1] });
    }
    pos = h4End + 1;
  }
  return cards;
}

/** ISO stage codes that indicate a published / confirmed standard (a usable replacement) */
const PUBLISHED_CODES = new Set(["60.60", "90.93"]);
/** ISO stage codes that indicate a draft / under-vote standard */
const DRAFT_CODES = new Set(["10.99", "20.00", "40.60"]);

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

    // Find the search term inside an <h4> tag using the clean-match guard:
    // rejects digit-before, digit-after, and digit+space-before patterns.
    const searchNum = ref.searchTerm;
    let resultIdx = -1;
    {
      let pos = 0;
      while (pos < html.length) {
        const i = html.indexOf(searchNum, pos);
        if (i === -1) break;
        if (isCleanH4Match(html, i, searchNum)) {
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

    // For replaced standards, scan ALL result cards in the page to find
    // whether a published successor or a draft version already exists.
    let replacedBy: string | undefined;
    let draftVersion: string | undefined;
    if (status === "replaced") {
      const allCards = extractResultCards(html, ref.searchTerm);
      // Skip the card we already found (the 90.92 one); look for others
      for (const card of allCards) {
        if (card.title === currentTitle) continue;
        // Skip national annexes — they're amendments of the same standard, not replacements
        if (card.title.includes("/NA:")) continue;
        if (PUBLISHED_CODES.has(card.statusCode)) {
          if (!replacedBy) replacedBy = card.title;
        } else if (DRAFT_CODES.has(card.statusCode) || card.title.startsWith("pr")) {
          if (!draftVersion) draftVersion = card.title;
        }
      }
    }

    const replacedNote = replacedBy
      ? `Замени с: ${replacedBy}`
      : draftVersion
        ? `Чернова в процес: ${draftVersion}`
        : "Нова версия не е публикувана все още";

    return {
      ...baseResult,
      status,
      statusCode,
      currentTitle,
      inlineDescription: ref.inlineDescription,
      titleMismatch: titleMismatch || undefined,
      replacedBy,
      draftVersion,
      note:
        status === "withdrawn"
          ? "Стандартът е оттеглен"
          : status === "under_review"
            ? "Стандартът е в процес на преразглеждане"
            : status === "replaced"
              ? replacedNote
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
