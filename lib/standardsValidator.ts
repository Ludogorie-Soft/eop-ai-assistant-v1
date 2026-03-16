/**
 * Validate Bulgarian standards and regulations against external sources.
 * - Standards (БДС/EN/ISO): checked against bds-bg.org
 * - Regulations (Наредба): checked against known status map (MVP)
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
  /** Inline description found in the source text (fallback when no full title) */
  inlineDescription?: string;
  /** Full title extracted from the source document (before or after the citation) */
  extractedTitle?: string;
  /** True when extractedTitle (or inlineDescription) does not match the official BDS title */
  titleMismatch?: boolean;
  /** Published successor standard (60.60/90.93) found on bds-bg.org for replaced standards */
  replacedBy?: string;
  /** Draft/work-in-progress successor (10.99/20.00/40.60 or "pr" prefix) for replaced standards */
  draftVersion?: string;
  /** URL to the source page for manual verification */
  sourceUrl?: string;
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
    const h4Text = html.slice(h4Start, h4End).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
    // Prefer the descriptive title after h4 over the bare code in h4
    let title = h4Text;
    if (!/[а-яa-z]{3,}/.test(h4Text)) {
      const afterH4 = html.slice(h4End + 1, h4End + 600);
      const statusPos = afterH4.search(/<span\s+class="label[^"]*"/);
      const searchArea = afterH4.slice(0, statusPos > 5 ? statusPos : 400);
      const descLines = searchArea
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/gi, " ")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 20 && /[а-яa-z]{4,}/.test(l));
      if (descLines[0]) title = descLines[0];
    }
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
 * Normalize a title string for comparison:
 * lowercase, strip punctuation/separators, collapse whitespace.
 */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:\-–—()\[\]\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute Jaccard similarity between two title strings.
 * Uses words ≥ 4 chars (skips short Bulgarian prepositions/articles).
 * Returns 0–1 where 1 = identical word sets.
 */
function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(normalizeTitle(s).split(" ").filter((w) => w.length >= 4));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Returns true when the document title does not match the official BDS title.
 * For full extracted titles: requires Jaccard similarity ≥ 0.3.
 * For short inline descriptions (≤ 5 words): requires at least 1 meaningful
 * word shared with the official title.
 */
function hasTitleMismatch(docTitle: string, officialTitle: string): boolean {
  if (!docTitle || !officialTitle) return false;
  const wordCount = docTitle.trim().split(/\s+/).length;
  if (wordCount <= 5) {
    // Short inline description — use simpler check (existing behaviour)
    const titleLower = normalizeTitle(officialTitle);
    const descWords = normalizeTitle(docTitle).split(" ").filter((w) => w.length >= 4);
    if (descWords.length === 0) return false;
    return descWords.filter((w) => titleLower.includes(w)).length === 0;
  }
  // Full title — use Jaccard similarity
  return titleSimilarity(docTitle, officialTitle) < 0.3;
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

    baseResult.sourceUrl = searchUrl;

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

    // Extract the full standard title from the <h4> containing the match.
    // On bds-bg.org the <h4> typically holds only the standard code ("БДС EN 1339:2005").
    // The human-readable descriptive title is in the next element (h5, p, or similar).
    const h4Start = html.lastIndexOf("<h4", resultIdx);
    const h4End = html.indexOf("</h4>", resultIdx);
    let currentTitle: string | undefined;
    if (h4Start >= 0 && h4End > h4Start) {
      const h4Text = html
        .slice(h4Start, h4End)
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, "")
        .trim();
      currentTitle = h4Text;
      // If h4 contains only a standard code (no lowercase Bulgarian letters),
      // look for the descriptive title in content between </h4> and the status label.
      if (!/[а-яa-z]{3,}/.test(h4Text)) {
        const afterH4 = html.slice(h4End + 1, h4End + 800);
        const statusPos = afterH4.search(/<span\s+class="label[^"]*"/);
        const searchArea = afterH4.slice(0, statusPos > 5 ? statusPos : 600);
        const descLines = searchArea
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/gi, " ")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length >= 20 && /[а-яa-z]{4,}/.test(l) && !/^\d+\.\d+$/.test(l));
        if (descLines[0]) currentTitle = descLines[0];
      }
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

    // Prefer extractedTitle for comparison; fall back to inlineDescription
    const docTitle = ref.extractedTitle ?? ref.inlineDescription;
    const titleMismatch =
      docTitle && currentTitle
        ? hasTitleMismatch(docTitle, currentTitle)
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
      extractedTitle: ref.extractedTitle,
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

/** Bulgarian month names (lowercase) for date matching */
const BG_MONTHS: Record<string, string> = {
  "01": "януари", "02": "февруари", "03": "март", "04": "април",
  "05": "май", "06": "юни", "07": "юли", "08": "август",
  "09": "септември", "10": "октомври", "11": "ноември", "12": "декември",
};

/**
 * Build search keywords from a regulation reference for Ciela's free zone.
 * Includes month name and key words from inline description for better matching.
 * "Наредба № 3 от 31.07.2003 г." + "за съставяне на актове" → "наредба 3 юли 2003 съставяне актове"
 * "Наредба № РД-02-20-1 от 05.02.2015 г." + "за влагане на строителни продукти" → "РД-02-20-1 февруари 2015 строителни продукти"
 */
function regulationSearchTerms(normalized: string, inlineDescription?: string): string {
  const idMatch = normalized.match(/№\s*([А-Яа-яA-Za-z\-]*\d[\w\-]*)/);
  const id = idMatch ? idMatch[1] : "";
  const dateMatch = normalized.match(/от\s+\d{1,2}\.(\d{1,2})\.(\d{4})/);
  const year = dateMatch ? dateMatch[2] : "";
  const month = dateMatch ? BG_MONTHS[dateMatch[1].padStart(2, "0")] ?? "" : "";
  const prefix = /^[0-9]+$/.test(id) ? "наредба " : "";
  // Extract 2-3 meaningful words from inline description (skip prepositions)
  let descWords = "";
  if (inlineDescription) {
    const words = inlineDescription
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !/^(като|това|която|които|при|или|след|преди|между)$/.test(w));
    descWords = words.slice(0, 3).join(" ");
  }
  return `${prefix}${id} ${month} ${year} ${descWords}`.replace(/\s+/g, " ").trim();
}

/**
 * Parse the regulation number and date parts from a normalized reference.
 * "Наредба № 3 от 31.07.2003 г." → { id: "3", year: "2003", month: "07" }
 * "Наредба № РД-02-20-1 от 05.02.2015 г." → { id: "РД-02-20-1", year: "2015", month: "02" }
 */
function parseRegRef(normalized: string): { id: string; year: string; month: string } {
  const idMatch = normalized.match(/№\s*([А-Яа-яA-Za-z\-]*\d[\w\-]*)/);
  const dateMatch = normalized.match(/от\s+\d{1,2}\.(\d{1,2})\.(\d{4})/);
  return {
    id: idMatch ? idMatch[1] : "",
    year: dateMatch ? dateMatch[2] : "",
    month: dateMatch ? dateMatch[1].padStart(2, "0") : "",
  };
}

/**
 * Match a Ciela result title against the regulation reference.
 * Checks that the title contains the correct regulation number and year.
 * Title example: "НАРЕДБА № 2 ОТ 17 ЯНУАРИ 2001 Г. ЗА СИГНАЛИЗАЦИЯ..."
 */
function matchesRegulation(title: string, ref: { id: string; year: string; month: string }): boolean {
  const t = title.toUpperCase();
  // Must contain the regulation number after "№" or "НАРЕДБА"
  const idUpper = ref.id.toUpperCase();
  // For simple numeric IDs: match "№ 3 " or "№ 3," exactly (not "№ 30" or "№ 38")
  if (/^[0-9]+$/.test(ref.id)) {
    const numPattern = new RegExp(`№\\s*${idUpper}(?:\\s|,|$)`, "i");
    if (!numPattern.test(t)) return false;
  } else {
    // For codes like РД-02-20-1: direct substring match
    if (!t.includes(idUpper)) return false;
  }
  // Must contain the year
  if (ref.year && !t.includes(ref.year)) return false;
  // Should contain the month name (if available)
  if (ref.month && BG_MONTHS[ref.month]) {
    if (!t.includes(BG_MONTHS[ref.month].toUpperCase())) return false;
  }
  // Must NOT be an amendment ("ИЗМЕНЕНИЕ И ДОПЪЛНЕНИЕ НА") of another regulation
  if (/ИЗМЕНЕНИЕ|ДОПЪЛНЕНИЕ/.test(t) && /НА\s+НАРЕДБА/.test(t)) return false;
  return true;
}

/**
 * Check a regulation reference against ciela.net free zone.
 * 1. Search the наредби listing with ?string= filter
 * 2. Find the matching regulation URL by comparing titles
 * 3. Fetch its page and parse the publication/status line
 */
async function checkRegulation(ref: ExtractedReference): Promise<ValidationResult> {
  const now = new Date().toISOString();
  const baseResult: ValidationResult = {
    reference: ref.normalized,
    status: "unknown",
    lastChecked: now,
    source: "ciela.net",
  };

  try {
    const searchTerms = regulationSearchTerms(ref.normalized, ref.inlineDescription);
    const parsed = parseRegRef(ref.normalized);
    const searchUrl =
      `https://www.ciela.net/svobodna-zona-normativi/category/85791/naredbi` +
      `?string=${encodeURIComponent(searchTerms)}`;

    console.log(`[checkRegulation] ${ref.normalized} → searching "${searchTerms}"`);

    // Step 1: Search the listing
    const { stdout: listHtml } = await execFileAsync("curl", [
      "-s", "-L",
      "--max-time", "20",
      "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      searchUrl,
    ], { maxBuffer: 5 * 1024 * 1024 });

    if (!listHtml || listHtml.length < 200) {
      return { ...baseResult, note: "Празен отговор от ciela.net" };
    }

    // Extract all regulation (title, url) pairs from search results
    const resultPattern = /href="(\/svobodna-zona-normativi\/view\/[^"]+)"[^>]*>\s*([^<]+)/g;
    const results: Array<{ url: string; title: string }> = [];
    let rm: RegExpExecArray | null;
    while ((rm = resultPattern.exec(listHtml)) !== null) {
      results.push({ url: rm[1], title: rm[2].trim() });
    }

    if (results.length === 0) {
      console.log(`[checkRegulation] ${ref.normalized} → not found in Ciela search`);
      return { ...baseResult, note: "Не е намерена в ciela.net" };
    }

    // Find the best matching result by checking title against regulation ID/year/month
    const match = results.find((r) => matchesRegulation(r.title, parsed));
    if (!match) {
      console.log(`[checkRegulation] ${ref.normalized} → ${results.length} results but no title match`);
      console.log(`[checkRegulation]   titles: ${results.slice(0, 3).map(r => r.title).join(" | ")}`);
      return { ...baseResult, note: "Не е намерена точно съвпадение в ciela.net" };
    }

    const regUrl = `https://www.ciela.net${match.url}`;
    console.log(`[checkRegulation] ${ref.normalized} → matched: "${match.title}"`);

    // Step 2: Fetch the regulation page
    const { stdout: pageHtml } = await execFileAsync("curl", [
      "-s", "-L",
      "--max-time", "20",
      "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      regUrl,
    ], { maxBuffer: 10 * 1024 * 1024 });

    if (!pageHtml || pageHtml.length < 200) {
      return { ...baseResult, sourceUrl: regUrl, note: "Празен отговор от страницата в ciela.net" };
    }

    // Extract the title from <title> tag
    const titleMatch = pageHtml.match(/<title>Ciela Norma - ([^<]+)<\/title>/i);
    const currentTitle = titleMatch
      ? titleMatch[1].replace(/ - Онлайн Наредби$/i, "").trim()
      : undefined;

    // Extract the publication/status block: starts at "Обн. ДВ." and typically
    // spans ~500 chars with comma-separated entries (изм., доп., отм.).
    // We grab a generous chunk and check for "отм. ДВ." which means the
    // entire regulation has been repealed.
    const plainText = pageHtml.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
    const obnIdx = plainText.indexOf("Обн. ДВ.");
    const statusBlock = obnIdx >= 0
      ? plainText.slice(obnIdx, obnIdx + 1000).replace(/\s+/g, " ").trim()
      : undefined;

    // "отм. ДВ." in the publication block means the whole regulation is repealed.
    // Individual article repeals appear deeper in the text, not in this block.
    const isRepealed = statusBlock ? /отм\.\s*ДВ\./i.test(statusBlock) : false;

    const status: ValidationStatus = isRepealed ? "withdrawn" : "valid";

    console.log(`[checkRegulation] ${ref.normalized} → ${status}${isRepealed ? " (отменена)" : " (в сила)"}`);

    return {
      ...baseResult,
      status,
      currentTitle,
      sourceUrl: regUrl,
      note: isRepealed
        ? "Наредбата е отменена"
        : "Наредбата е в сила",
    };
  } catch (err) {
    return {
      ...baseResult,
      note: `Грешка: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
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

  // Separate regulations from standards
  const regulations = toCheck.filter((r) => r.type !== "standard");
  const standards = toCheck.filter((r) => r.type === "standard");

  // Process regulations via ciela.net (batches of 3 — two curl calls each)
  if (regulations.length > 0) {
    const REG_BATCH = 3;
    for (let i = 0; i < regulations.length; i += REG_BATCH) {
      const batch = regulations.slice(i, i + REG_BATCH);
      const batchStart = Date.now();
      console.log(
        `[standardsValidator] Checking regulation ${i + 1}-${Math.min(i + REG_BATCH, regulations.length)} of ${regulations.length}...`
      );
      const batchResults = await Promise.all(batch.map((ref) => checkRegulation(ref)));
      for (let j = 0; j < batch.length; j++) {
        results.set(batch[j].normalized, batchResults[j]);
      }
      console.log(
        `[standardsValidator] Regulations batch done in ${((Date.now() - batchStart) / 1000).toFixed(1)}s`
      );
      if (i + REG_BATCH < regulations.length) {
        await delay(500);
      }
    }
  }

  // Process standards in batches of 5 concurrent requests via bds-bg.org
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
