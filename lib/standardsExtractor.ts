/**
 * Extract references to Bulgarian standards (БДС, EN, ISO) and regulations (Наредба)
 * from KSS/SMR text content. Server-side only.
 * Laws (Закон за ...) are intentionally excluded — only standards and Наредби are validated.
 */

export type ReferenceType = "standard" | "regulation";

export type ExtractedReference = {
  raw: string;
  normalized: string;
  type: ReferenceType;
  searchTerm: string;
  /**
   * Full title adjacent to the citation in the source text.
   * Can appear BEFORE (e.g. "Заглавие — БДС EN 933-1") or
   * AFTER (e.g. "БДС EN 933-1 — Заглавие") the citation.
   * Used for 1:1 comparison against the official BDS title.
   */
  extractedTitle?: string;
  /** @deprecated Use extractedTitle. Short inline desc captured after the citation. */
  inlineDescription?: string;
};

/** Strip HTML tags from a string */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
}

/**
 * Normalize a standard reference for deduplication and cache lookup.
 * "БДС EN 12697-6:2020" → "БДС EN 12697-6"
 * "БДС ЕN 13108-1:2006/NA:2017" → "БДС EN 13108-1"
 * "БДС 1517-2020" → "БДС 1517"  (dash-year stripped)
 * "БДС 1517:2020" → "БДС 1517"  (colon-year stripped)
 */
function normalizeStandard(raw: string): string {
  let s = raw.trim();
  // Normalize Cyrillic lookalikes: Е→E, N→N (Cyrillic Н can look like N)
  s = s.replace(/ЕN/g, "EN").replace(/ЕН/g, "EN");
  // Remove colon-year suffixes (:2020, :2006/NA:2017, /Поправка 1:2017, etc.)
  s = s.replace(/:[0-9]{4}.*$/, "");
  // Remove dash-year suffix ("-2020") — only when the trailing part is a 4-digit year (1900–2099)
  // Distinguishes "1517-2020" (year) from "12697-6" (part number)
  s = s.replace(/-([12][0-9]{3})$/, (_, year) => {
    const y = parseInt(year, 10);
    return y >= 1900 && y <= 2099 ? "" : `-${year}`;
  });
  // Strip trailing punctuation (dots, commas) that the regex may have captured
  s = s.replace(/[.,;]+$/, "");
  return s.trim();
}

/**
 * Build search term for bds-bg.org from a normalized standard reference.
 * "БДС EN 12697-6" → "12697-6"  (the numeric part works best as keyword search)
 */
function standardSearchTerm(normalized: string): string {
  // Extract the numeric portion (e.g. "12697-6" from "БДС EN 12697-6")
  const numMatch = normalized.match(/(\d[\d\-.:]+\d)/);
  return numMatch ? numMatch[1] : normalized;
}

/**
 * Normalize a regulation reference for deduplication.
 * Keeps the full identifier with number and date:
 * "НАРЕДБА № 3 от 31.07.2003 г." → "Наредба №3 от 31.07.2003 г."
 * "Наредба РД-02-20-1 от 01.04.2024 г" → "Наредба РД-02-20-1 от 01.04.2024 г."
 * "Наредба № РД-02-20-1 от 05.02.2015 г." → "Наредба №РД-02-20-1 от 05.02.2015 г."
 */
function normalizeRegulation(raw: string): string {
  let s = raw.trim();
  // Normalize first word to title case: НАРЕДБА → Наредба
  s = s.replace(/^[А-ЯA-Z][А-Яа-яA-Za-z]+/, (w) => w[0] + w.slice(1).toLowerCase());
  // Normalize № / No to "№ " (with space after)
  s = s.replace(/\s*(?:№|No\.?)\s*/i, " № ");
  // Normalize "от" to lowercase
  s = s.replace(/\s+[Оо][Тт]\s+/, " от ");
  // Ensure trailing "г." is present
  s = s.replace(/(\d{4})\s*г?\.?$/, "$1 г.");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Standards: БДС EN ..., БДС ISO ..., БДС EN ISO ..., standalone EN/ISO
const STANDARD_PATTERNS = [
  // БДС EN ISO 9001:2015/NA:2017/Поправка...
  /БДС\s+E[NН]\s+ISO\s+\d[\d\-.:\/A-Za-z]*/i,
  // БДС EN 12697-6:2020
  /БДС\s+E[NН]\s+\d[\d\-.:\/A-Za-z]*/i,
  // БДС ISO 9001
  /БДС\s+ISO\s+\d[\d\-.:\/A-Za-z]*/i,
  // БДС 17143-90  (national-only)
  /БДС\s+\d[\d\-.:\/A-Za-z]*/i,
  // Standalone EN references (e.g. "EN 13108")
  /(?<![А-Яа-яA-Za-z])EN\s+\d[\d\-.:\/A-Za-z]*/i,
  // Standalone ISO references
  /(?<![А-Яа-яA-Za-z])ISO\s+\d[\d\-.:\/A-Za-z]*/i,
];

// Regulations — only Наредби (laws/Закони are excluded from validation)
const REGULATION_PATTERNS = [
  // With № sign + date required: Наредба №3 от 31.07.2003 г., Наредба № РД-02-20-1 от 05.02.2015 г.
  /[Нн][Аа][Рр][Ее][Дд][Бб][Аа]\s*(?:№|No\.?)\s*[А-Яа-яA-Za-z\-]*\d[\w\-]*\s+[Оо][Тт]\s+\d{1,2}[\.\s]\d{1,2}[\.\s]\d{4}\s*г\.?/,
  // Without № sign + date required: Наредба РД-02-20-1 от 01.04.2024 г
  /[Нн][Аа][Рр][Ее][Дд][Бб][Аа]\s+[А-Яа-яA-Za-z]+[\-]\d[\w\-]*\s+[Оо][Тт]\s+\d{1,2}[\.\s]\d{1,2}[\.\s]\d{4}\s*г\.?/,
];

/**
 * Attempt to capture a short inline description that follows a standard reference.
 * Patterns: "за <words>", "- <words>", "– <words>", "— <words>"
 * Up to ~80 chars, stopping at sentence-ending punctuation or newline.
 */
function captureInlineDescription(text: string, afterIdx: number): string | undefined {
  const tail = text.slice(afterIdx, afterIdx + 120);
  // Optional year suffix like :1996 before the separator
  const trimmed = tail.replace(/^:[0-9]{4}(?:\/[A-Z0-9:]+)*/, "");
  const m = trimmed.match(/^\s*(?:за|–|-|—|:)\s+([^,.\n;(]{5,80})/);
  if (!m) return undefined;
  // Stop at references to other standards/regulations
  return m[1].replace(/\s*(?:БДС|EN|ISO|Наредба)\b.*$/, "").trim() || undefined;
}

const TITLE_SEPARATORS = /\s*(?:–|—|-{1,2}|:)\s*/;

/**
 * Try to capture a full standard title that appears AFTER the citation.
 * e.g. "БДС EN 933-1:2012 – Изпитвания за геометрични характеристики..."
 * Title must start with an uppercase letter and be at least 15 chars.
 *
 * Bulgarian БДС titles follow "Topic. Subtopic. Method" — at most 3 ". "-separated
 * segments. Body text starts after the 3rd segment, or after another citation.
 */
function captureTitleAfter(text: string, afterIdx: number): string | undefined {
  // Skip optional year/amendment suffix
  const tail = text.slice(afterIdx, afterIdx + 300);
  const withoutYear = tail.replace(/^(?::[0-9]{4}(?:\/[A-Z0-9:]+)*)?\s*/, "");
  const sepMatch = withoutYear.match(/^(?:–|—|-{1,2})\s*/);
  if (!sepMatch) return undefined;
  const rest = withoutYear.slice(sepMatch[0].length);
  // Must start with uppercase (Bulgarian or Latin) — not a preposition/conjunction
  if (!/^[А-ЯA-Z]/.test(rest)) return undefined;
  // Grab up to 250 chars on the same line (newline = strong boundary)
  const line = rest.match(/^[^\n]{15,250}/)?.[0] ?? "";
  if (!line || line.length < 15) return undefined;
  // Cut before another standard citation (space prefix prevents cutting mid-word)
  let title = line.replace(/\s+(?:БДС\b|EN\s+\d|ISO\s+\d|Наредба\s).*$/, "").trim();
  // Cut at Bulgarian clause connectives following a comma — these signal body text,
  // not a list within a title noun phrase (e.g. "Бои, термопластични..." is fine, but
  // "Физични характеристики , както и на..." should stop at "Физични характеристики").
  title = title.replace(/,\s+(?:как|а\s|но\s|или\s|при\s|тъй\b|поради|освен|вкл|т\.|и\s+т\.).*$/i, "").trim();
  // БДС titles follow "Topic. Subtopic. Method" structure.
  // Split on ". " before uppercase; keep first 2 parts unconditionally.
  // Include the 3rd part only if it is a short noun phrase (≤ 40 chars) —
  // long 3rd segments are body text that leaked in (e.g. ". Синият маркировъчен слой трябва...").
  const parts = title.split(/\.\s+(?=[А-ЯA-Z])/);
  if (parts.length >= 3) {
    const third = parts[2].trim();
    title = third.length <= 40
      ? parts.slice(0, 3).join(". ")
      : parts.slice(0, 2).join(". ");
  }
  // Hard cap at 200 chars; cut at last word boundary
  if (title.length > 200) {
    title = title.slice(0, 200).replace(/\s+\S*$/, "");
  }
  title = title.replace(/[.,;]+$/, "").trim();
  return title.split(/\s+/).length >= 2 ? title : undefined;
}

/**
 * Try to capture a full standard title that appears BEFORE the citation.
 * e.g. "Изпитвания за геометрични характеристики – БДС EN 933-1"
 * Looks back up to 350 chars for a separator (" – ", " — ") followed by the citation.
 *
 * Splits on newlines and semicolons only (NOT periods) so that multi-part titles like
 * "Тема. Подтема. Метод" are captured whole, not just the last fragment.
 */
function captureTitleBefore(text: string, beforeIdx: number): string | undefined {
  const window = text.slice(Math.max(0, beforeIdx - 350), beforeIdx);
  // Find the LAST separator before the citation (could be " – ", " — ", " - ")
  const sepRe = /(?:–|—|-{1,2})\s*$/;
  const sepMatch = window.match(sepRe);
  if (!sepMatch || sepMatch.index === undefined) return undefined;
  const candidate = window.slice(0, sepMatch.index).trim();
  if (candidate.length < 15) return undefined;
  // Split on hard boundaries only (newline, semicolon) — not periods, which appear inside titles
  const lastBlock = candidate.split(/[\n;]/).pop()?.trim() ?? "";
  if (!lastBlock || lastBlock.length < 15) return undefined;
  if (!/^[А-ЯA-Z]/.test(lastBlock)) return undefined;
  // Hard cap at 200 chars; also cut before any standard citation embedded in the block
  let title = lastBlock.replace(/\s+(?:БДС\b|EN\s+\d|ISO\s+\d|Наредба\s).*$/, "").trim();
  if (title.length > 200) title = title.slice(0, 200).replace(/\s+\S*$/, "").trim();
  title = title.replace(/[.,;]+$/, "").trim();
  return title.split(/\s+/).length >= 2 ? title : undefined;
}

/**
 * Capture the best available title (before or after citation).
 * Prefers AFTER since it's more reliable in Bulgarian SMR documents.
 */
function captureExtractedTitle(text: string, matchStart: number, matchEnd: number): string | undefined {
  return captureTitleAfter(text, matchEnd) ?? captureTitleBefore(text, matchStart);
}
/**
 * Canonical deduplication key for standards.
 * Strips the "БДС " prefix so that "БДС EN 933-1" and "EN 933-1" are treated as the same.
 * The БДС-prefixed form (encountered first) wins and is kept.
 */
export function canonicalKey(normalized: string): string {
  return normalized.replace(/^БДС\s+/, "");
}

export function extractReferences(text: string): ExtractedReference[] {
  if (!text?.trim()) return [];

  const plain = stripHtml(text);
  const seen = new Set<string>(); // keyed by canonicalKey
  const results: ExtractedReference[] = [];

  // Standards
  for (const pattern of STANDARD_PATTERNS) {
    for (const match of plain.matchAll(new RegExp(pattern.source, "gi"))) {
      const raw = match[0].trim();
      const normalized = normalizeStandard(raw);
      // Skip malformed/truncated references whose number ends with a dash
      if (/\-$/.test(normalized)) continue;
      const key = canonicalKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      const matchEnd = match.index! + match[0].length;
      const extractedTitle = captureExtractedTitle(plain, match.index!, matchEnd);
      const inlineDescription = extractedTitle
        ? undefined
        : captureInlineDescription(plain, matchEnd);
      results.push({
        raw,
        normalized,
        type: "standard",
        searchTerm: standardSearchTerm(normalized),
        extractedTitle,
        inlineDescription,
      });
    }
  }

  // Regulations
  for (const pattern of REGULATION_PATTERNS) {
    for (const match of plain.matchAll(new RegExp(pattern.source, "g"))) {
      const raw = match[0].trim();
      const normalized = normalizeRegulation(raw);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const inlineDescription = captureInlineDescription(plain, match.index! + match[0].length);
      results.push({
        raw,
        normalized,
        type: "regulation",
        searchTerm: raw,
        inlineDescription,
      });
    }
  }

  return results;
}
