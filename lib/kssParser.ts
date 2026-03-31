/**
 * KSS Excel parser — normalizes rows into KssItem array.
 * Uses xlsx for parsing. Server-side only.
 */

import * as XLSX from "xlsx";

export type KssItem = {
  code: string;
  name: string;
  unit: string;
  quantity: number;
};

/** Default column mapping (code, name, unit, quantity). Adjust if your Excel uses different headers. */
const DEFAULT_HEADERS = {
  code: ["код", "code", "№", "номер", "поз"],
  name: [
    "наименование на видовете работи",
    "наименование",
    "name",
    "описание",
    "описание на позиция",
  ],
  unit: ["м.е.", "ед.", "единица", "unit", "measure"],
  quantity: ["количество", "quantity", "кол"],
};

function findColumnIndex(row: unknown[], aliases: string[]): number {
  const normalized = (v: unknown) =>
    String(v ?? "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  const rowStr = row.map(normalized);
  for (const alias of aliases) {
    const idx = rowStr.findIndex(
      // cell must be non-empty — prevents empty string from matching every alias via alias.includes("")
      (cell) => cell.length > 0 && (cell.includes(alias) || alias.includes(cell)),
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function safeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  const s = String(value).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Roman numeral section header codes used in Bulgarian KSS Excel files:
 * "І.", "IІ.", "IIІ.", "IV.", "V." etc. (mix of Cyrillic і/І and Latin I/V/X)
 */
const ROMAN_NUMERAL_CODE = /^[IVXіІ]+\.?\s*$/;

/**
 * Summary/total row codes at the bottom of KSS tables.
 */
const SUMMARY_ROW_CODE = /^(Сума|Непредвидени|Обща\s+сума|ДДС|Всичко)\s*/i;

/** True if row looks like a category/separator — section header that should not be matched to SMR */
function isCategoryRow(code: string, name: string): boolean {
  const combined = `${code} ${name}`.trim();
  if (!combined) return true;
  // "Сметка N" pattern
  if (/^Сметка\s*\d+/i.test(combined)) return true;
  // Roman numeral section headers (e.g. "І.", "IІ.", "IIІ.", "IV.")
  if (ROMAN_NUMERAL_CODE.test(code.trim())) return true;
  // Section label in code column with empty name — e.g. "УЛИЧНО ПЛАТНО", "ТРОТОАРИ", "ПАРКИНГ", "ОТВОДНЯВАНЕ", "ОБЩА ПЛОЩ: 5818 m2".
  // These are road-section descriptors or measurement metadata, not work items.
  // Detected by: code contains 3+ consecutive Cyrillic uppercase letters AND name is empty.
  if (code.trim() && !name.trim() && /[А-Я]{3,}/u.test(code.trim())) return true;
  // Same pattern in name column with empty code (all-uppercase variant)
  if (!code.trim() && name.trim() && /[А-Я]{3,}/u.test(name.trim()) &&
      name.trim() === name.trim().toUpperCase()) return true;
  // Known road-section names in mixed-case (e.g. "Паркинг", "Отводняване", "Тротоари", "Улично платно")
  // These may appear with a non-empty code (e.g. "2.", "А.") so the checks above miss them.
  const ROAD_SECTION_NAMES = /^(улично\s+платно|тротоари|паркинг|отводняване)$/i;
  if (ROAD_SECTION_NAMES.test(code.trim()) || ROAD_SECTION_NAMES.test(name.trim())) return true;
  // Metadata patterns (area/length totals) that appear anywhere in code or name
  if (/^обща\s+(площ|дължина)/i.test(code.trim()) ||
      /^обща\s+(площ|дължина)/i.test(name.trim())) return true;
  return false;
}

/**
 * True when we've reached the totals/summary section at the bottom of the KSS table.
 * Everything below this point (pricing elements, etc.) should be excluded.
 */
function isSummaryRow(code: string): boolean {
  return SUMMARY_ROW_CODE.test(code.trim());
}

/**
 * True if the row is actually a repeated/duplicated column-header row inside the data.
 * Happens when Excel sheets repeat the header mid-table. These rows must be skipped.
 * Checks whether the name cell matches any known name-column header alias.
 */
function isDataHeaderRow(name: string, code: string): boolean {
  const nameLower = name.toLowerCase().trim().replace(/\s+/g, " ");
  const codeLower = code.toLowerCase().trim().replace(/\s+/g, " ");
  // If the "name" cell matches any of the name-column header aliases, it's a header row
  for (const alias of DEFAULT_HEADERS.name) {
    if (
      nameLower === alias ||
      nameLower.includes(alias) ||
      alias.includes(nameLower)
    ) {
      if (nameLower.length > 3) return true; // guard against overly short coincidences
    }
  }
  // If the "code" cell matches any of the code-column header aliases, it's a header row
  for (const alias of DEFAULT_HEADERS.code) {
    if (codeLower === alias) return true;
  }
  return false;
}

export type ParseKssResult = {
  items: KssItem[];
  /** True when expected headers (код, наименование, м.е., количество, etc.) were found */
  headersMatched: boolean;
};

/**
 * Scan up to the first 25 rows to find the actual header row.
 * Returns the index of the first row that looks like a data header (contains name + quantity aliases).
 * Falls back to 0 if not found.
 */
function findHeaderRowIndex(data: unknown[][]): number {
  for (let i = 0; i < Math.min(data.length, 25); i++) {
    const row = data[i] as unknown[];
    const hasName = findColumnIndex(row, DEFAULT_HEADERS.name) >= 0;
    const hasQuantity = findColumnIndex(row, DEFAULT_HEADERS.quantity) >= 0;
    if (hasName && hasQuantity) return i;
  }
  return 0;
}

/**
 * Parse KSS Excel buffer and return normalized KssItem[].
 * Scans the first 25 rows to find the actual header row (handles Excel files with title
 * rows before the data table). Uses heuristics to find code, name, unit, quantity columns.
 * If headers don't match known aliases, falls back to columns 0–3, but headersMatched will be false.
 */
export function parseKssExcel(buffer: Buffer): ParseKssResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { items: [], headersMatched: true };

  const data = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  if (data.length < 2) return { items: [], headersMatched: true };

  const headerRowIndex = findHeaderRowIndex(data);
  const headerRow = data[headerRowIndex] as unknown[];
  const codeIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.code);
  const nameIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.name);
  const unitIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.unit);
  const quantityIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.quantity);

  const headersMatched =
    codeIdx >= 0 && nameIdx >= 0 && unitIdx >= 0 && quantityIdx >= 0;

  // Fallback: if no headers matched, assume first 4 columns are code, name, unit, quantity
  const c = codeIdx >= 0 ? codeIdx : 0;
  const n = nameIdx >= 0 ? nameIdx : 1;
  const u = unitIdx >= 0 ? unitIdx : 2;
  const q = quantityIdx >= 0 ? quantityIdx : 3;

  const items: KssItem[] = [];

  // Start from the row AFTER the header row
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    const code = safeString(row[c]);
    const name = safeString(row[n]);
    const unit = safeString(row[u]);
    const quantity = safeNumber(row[q]);

    if (!name && !code) continue;
    // Skip totals/summary rows (ДДС, Обща сума, etc.) — they appear between sections too,
    // so we continue instead of break to handle multi-section KSS files
    // (Улично платно + Тротоари + Паркинг + Отводняване, etc.).
    if (isSummaryRow(code)) continue;
    if (isCategoryRow(code, name)) continue;
    if (isDataHeaderRow(name, code)) continue;
    items.push({
      code: code || `Поз.${i}`,
      name: name || "(без име)",
      unit: unit || "бр.",
      quantity,
    });
  }

  return { items, headersMatched };
}
