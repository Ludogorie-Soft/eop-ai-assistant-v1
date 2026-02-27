/**
 * SMR template DOCX parser.
 * Positions in "Шаблони СМР.docx" are tables: first cell = position name (bold/italic),
 * body = all text between this title table and the next title table.
 * Intermediate data tables (e.g. expert roles) are included as part of the body text.
 * We detect tables with mammoth HTML and extract title from first <td>, body from content after </table> until next TITLE <table>.
 */

import mammoth from "mammoth";

export type SmrTemplate = {
  title: string;
  body: string;
  /** Raw HTML from after the title table to before the next title table. Includes formatting and base64 images. */
  htmlBody: string;
};

/** Strip HTML tags and collapse whitespace to get plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Extract text from first <td> in a table HTML (position name, often bold/italic in docx) */
function extractTitleFromTable(tableHtml: string): string {
  const firstTd = tableHtml.match(/<td[^>]*>([\s\S]*?)<\/td\s*>/i);
  if (!firstTd) return "";
  return htmlToText(firstTd[1]);
}

/** Determine if a table qualifies as a section title table (activity header) */
function isTitleTable(tableHtml: string): boolean {
  const firstTd = tableHtml.match(/<td[^>]*>([\s\S]*?)<\/td\s*>/i);
  if (!firstTd) return false;
  const tdContent = firstTd[1];

  // Position title tables in "Шаблони СМР.docx" always have <strong> or <em> wrapping.
  // Body content tables (data rows, resource tables) do NOT — they are plain text.
  const hasBoldOrItalic = /<strong>|<em>/i.test(tdContent);
  if (!hasBoldOrItalic) return false;

  const title = htmlToText(tdContent);
  if (!title || title.length < 3) return false;

  // Guard against accidentally matching long body-content tables
  if (title.length > 220) return false;

  // Skip ALL-CAPS section headers (e.g. "ПОДГОТВИТЕЛНИ И ЗЕМНИ РАБОТИ")
  const stripped = title.replace(/[\s\d.,;:()\-–—\/]/g, "");
  const hasLower = /[а-яa-z]/.test(stripped);
  return hasLower || stripped.length === 0;
}

/**
 * Find all title tables and extract body text for each.
 * Body extends from after the title table to just before the NEXT title table,
 * so intermediate data tables (expert roles, etc.) are included as part of the body.
 */
function splitByTables(html: string): Array<{ title: string; body: string; htmlBody: string }> {
  const fullHtml = html.replace(/^\s+|\s+$/g, "");
  const blocks: Array<{ title: string; body: string; htmlBody: string }> = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table\s*>/gi;
  const tableMatches: Array<{
    index: number;
    length: number;
    tableHtml: string;
  }> = [];
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(fullHtml)) !== null) {
    tableMatches.push({
      index: match.index,
      length: match[0].length,
      tableHtml: match[0],
    });
  }

  // Identify indices of title tables (section starters) only
  const titleIndices: number[] = [];
  for (let i = 0; i < tableMatches.length; i++) {
    if (isTitleTable(tableMatches[i].tableHtml)) {
      titleIndices.push(i);
    }
  }

  for (let t = 0; t < titleIndices.length; t++) {
    const i = titleIndices[t];
    const title = extractTitleFromTable(tableMatches[i].tableHtml);

    const afterTableStart = tableMatches[i].index + tableMatches[i].length;

    // Body ends at the start of the NEXT title table (not just any table),
    // so intermediate data tables are included in the body text.
    const nextTitleIdx = t + 1 < titleIndices.length ? titleIndices[t + 1] : -1;
    const bodyEnd =
      nextTitleIdx >= 0 ? tableMatches[nextTitleIdx].index : fullHtml.length;

    const bodyHtml = fullHtml.slice(afterTableStart, bodyEnd);
    const body = htmlToText(bodyHtml);

    // Skip entries with no meaningful body (likely header/separator tables)
    if (body.trim().length < 20) continue;

    blocks.push({ title: title!.trim(), body: body.trim(), htmlBody: bodyHtml.trim() });
  }

  return blocks;
}

/**
 * Parse SMR template DOCX buffer.
 * Each position = one table (first cell = title). Body = text under the table until the next table.
 */
export async function parseSmrTemplateDocx(
  buffer: Buffer,
): Promise<SmrTemplate[]> {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value ?? "";

  const blocks = splitByTables(html);

  return blocks.map((b) => ({
    title: b.title,
    body: b.body,
    htmlBody: b.htmlBody,
  }));
}
