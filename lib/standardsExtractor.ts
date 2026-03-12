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

// Regulations — only Наредби (laws/Закони are excluded from validation)
const REGULATION_PATTERNS = [
  // With № sign + date required: Наредба №3 от 31.07.2003 г., Наредба № РД-02-20-1 от 05.02.2015 г.
  /[Нн][Аа][Рр][Ее][Дд][Бб][Аа]\s*(?:№|No\.?)\s*[А-Яа-яA-Za-z\-]*\d[\w\-]*\s+[Оо][Тт]\s+\d{1,2}[\.\s]\d{1,2}[\.\s]\d{4}\s*г\.?/g,
  // Without № sign + date required: Наредба РД-02-20-1 от 01.04.2024 г
  /[Нн][Аа][Рр][Ее][Дд][Бб][Аа]\s+[А-Яа-яA-Za-z]+[\-]\d[\w\-]*\s+[Оо][Тт]\s+\d{1,2}[\.\s]\d{1,2}[\.\s]\d{4}\s*г\.?/g,
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
      const inlineDescription = captureInlineDescription(plain, match.index + match[0].length);
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
