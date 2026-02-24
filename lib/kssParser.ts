/**
 * KSS Excel parser — normalizes rows into KssItem array.
 * Uses xlsx for parsing. Server-side only.
 */

import * as XLSX from 'xlsx';

export type KssItem = {
  code: string;
  name: string;
  unit: string;
  quantity: number;
};

/** Default column mapping (code, name, unit, quantity). Adjust if your Excel uses different headers. */
const DEFAULT_HEADERS = {
  code: ['код', 'code', '№', 'номер', 'поз'],
  name: [
    'наименование на видовете работи',
    'наименование',
    'name',
    'описание',
    'описание на позиция',
  ],
  unit: ['м.е.', 'ед.', 'единица', 'unit', 'measure'],
  quantity: ['количество', 'quantity', 'кол'],
};

function findColumnIndex(
  row: unknown[],
  aliases: string[]
): number {
  const normalized = (v: unknown) =>
    String(v ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  const rowStr = row.map(normalized);
  for (const alias of aliases) {
    const idx = rowStr.findIndex((cell) =>
      cell.includes(alias) || alias.includes(cell)
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function safeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const s = String(value).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** True if row looks like a category/separator (e.g. "Сметка 1 ПОДГОТВИТЕЛНИ РАБОТИ", "Сметка 2 ЗЕМНИ РАБОТИ") */
function isCategoryRow(code: string, name: string): boolean {
  const combined = `${code} ${name}`.trim();
  if (!combined) return true;
  return /^Сметка\s*\d+/i.test(combined);
}

/**
 * Parse KSS Excel buffer and return normalized KssItem[].
 * Expects first row to be headers. Uses heuristics to find code, name, unit, quantity columns.
 */
export function parseKssExcel(buffer: Buffer): KssItem[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];

  if (data.length < 2) return [];

  const headerRow = data[0] as unknown[];
  const codeIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.code);
  const nameIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.name);
  const unitIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.unit);
  const quantityIdx = findColumnIndex(headerRow, DEFAULT_HEADERS.quantity);

  // Fallback: if no headers matched, assume first 4 columns are code, name, unit, quantity
  const c = codeIdx >= 0 ? codeIdx : 0;
  const n = nameIdx >= 0 ? nameIdx : 1;
  const u = unitIdx >= 0 ? unitIdx : 2;
  const q = quantityIdx >= 0 ? quantityIdx : 3;

  const items: KssItem[] = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    const code = safeString(row[c]);
    const name = safeString(row[n]);
    const unit = safeString(row[u]);
    const quantity = safeNumber(row[q]);

    if (!name && !code) continue;
    if (isCategoryRow(code, name)) continue;
    items.push({
      code: code || `Поз.${i}`,
      name: name || '(без име)',
      unit: unit || 'бр.',
      quantity,
    });
  }

  return items;
}
