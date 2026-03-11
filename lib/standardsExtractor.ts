/**
 * Extract references to Bulgarian standards (БДС, EN, ISO) and regulations (Наредба, Закон)
 * from KSS/SMR text content. Server-side only.
 */

export type ReferenceType = "standard" | "regulation";

export type ExtractedReference = {
  raw: string;
  normalized: string;
  type: ReferenceType;
  searchTerm: string;
  /** Short inline description captured from the source text, e.g. "за изпитвания на зърнометричен състав" */
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
 * "Наредба № 3 от 16.08.2010 г." → "Наредба 3"
 * "НАРЕДБА № 18 ОТ ..." → "Наредба 18"  (ALL-CAPS normalized)
 * "Наредба No РД-02-20-2" → "Наредба РД-02-20-2"
 */
function normalizeRegulation(raw: string): string {
  let s = raw.trim();
  // Normalize first word to title case: НАРЕДБА → Наредба, ЗАКОН → Закон
  s = s.replace(/^[А-ЯA-Z][А-Яа-яA-Za-z]+/, (w) => w[0] + w.slice(1).toLowerCase());
  // Remove "от ... г." date suffix
  s = s.replace(/\s+от\s+\d{1,2}[\.\s]\d{1,2}[\.\s]\d{4}\s*г\.?/i, "");
  // Normalize № / No / N to just space
  s = s.replace(/\s*(?:№|No\.?|N)\s*/i, " ");
  // Strip anything after the number — captures like "Наредба 18 ОТ 23 ЮЛИ" become "Наредба 18"
  s = s.replace(/^((?:Наредба|Закон\s+за\s+\S+)\s+[\w\-]+).*$/, "$1");
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
  /БДС\s+E[NН]\s+ISO\s+\d[\d\-.:\/A-Za-z]*/gi,
  // БДС EN 12697-6:2020
  /БДС\s+E[NН]\s+\d[\d\-.:\/A-Za-z]*/gi,
  // БДС ISO 9001
  /БДС\s+ISO\s+\d[\d\-.:\/A-Za-z]*/gi,
  // БДС 17143-90  (national-only)
  /БДС\s+\d[\d\-.:\/A-Za-z]*/gi,
  // Standalone EN references (e.g. "EN 13108")
  /(?<![А-Яа-яA-Za-z])EN\s+\d[\d\-.:\/A-Za-z]*/gi,
  // Standalone ISO references
  /(?<![А-Яа-яA-Za-z])ISO\s+\d[\d\-.:\/A-Za-z]*/gi,
];

// Regulations
const REGULATION_PATTERNS = [
  // Наредба № 3 от 16.08.2010 г.  /  НАРЕДБА № 18 ОТ ...
  /[Нн][Аа][Рр][Ее][Дд][Бб][Аа]\s*(?:№|No\.?|N)\s*[\w\-]+(?:\s+от\s+\d{1,2}[\.\s]\d{1,2}[\.\s]\d{4}\s*г\.?)?/g,
  // Закон за [пътищата / устройство на територията] — stops before a word starting with uppercase
  // No `i` flag: [а-я] must stay case-sensitive so Т in "Технически" (uppercase) stops the match
  /Закон[а]?\s+за\s+[а-яА-Я][а-я]+(?:\s+[а-я][а-яА-Я]*){0,6}/g,
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
  return m[1].trim();
}
/**
 * Canonical deduplication key for standards.
 * Strips the "БДС " prefix so that "БДС EN 933-1" and "EN 933-1" are treated as the same.
 * The БДС-prefixed form (encountered first) wins and is kept.
 */
function canonicalKey(normalized: string): string {
  return normalized.replace(/^БДС\s+/, "");
}

export function extractReferences(text: string): ExtractedReference[] {
  if (!text?.trim()) return [];

  const plain = stripHtml(text);
  const seen = new Set<string>(); // keyed by canonicalKey
  const results: ExtractedReference[] = [];

  // Standards
  for (const pattern of STANDARD_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(plain)) !== null) {
      const raw = match[0].trim();
      const normalized = normalizeStandard(raw);
      // Skip malformed/truncated references whose number ends with a dash
      if (/\-$/.test(normalized)) continue;
      const key = canonicalKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      const inlineDescription = captureInlineDescription(plain, match.index + match[0].length);
      results.push({
        raw,
        normalized,
        type: "standard",
        searchTerm: standardSearchTerm(normalized),
        inlineDescription,
      });
    }
  }

  // Regulations
  for (const pattern of REGULATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(plain)) !== null) {
      const raw = match[0].trim();
      const normalized = normalizeRegulation(raw);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({
        raw,
        normalized,
        type: "regulation",
        searchTerm: raw,
      });
    }
  }

  return results;
}
