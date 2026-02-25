/**
 * SMR template DOCX parser.
 * Positions in "Шаблони СМР.docx" are tables: first cell = position name (bold/italic),
 * body = all text between this table and the next table.
 * We detect tables with mammoth HTML and extract title from first <td>, body from content after </table> until next <table>.
 */

import mammoth from 'mammoth';

export type SmrTemplate = {
  title: string;
  body: string;
};

/** Strip HTML tags and collapse whitespace to get plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/** Extract text from first <td> in a table HTML (position name, often bold/italic in docx) */
function extractTitleFromTable(tableHtml: string): string {
  const firstTd = tableHtml.match(/<td[^>]*>([\s\S]*?)<\/td\s*>/i);
  if (!firstTd) return '';
  return htmlToText(firstTd[1]);
}

/**
 * Find all <table>...</table> blocks and the content after each.
 * Returns list of { title, body } where title = first cell text, body = text between this table and next.
 */
function splitByTables(html: string): Array<{ title: string; body: string }> {
  const fullHtml = html.replace(/^\s+|\s+$/g, '');
  const blocks: Array<{ title: string; body: string }> = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table\s*>/gi;
  const tableMatches: Array<{ index: number; length: number; tableHtml: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(fullHtml)) !== null) {
    tableMatches.push({
      index: match.index,
      length: match[0].length,
      tableHtml: match[0],
    });
  }

  for (let i = 0; i < tableMatches.length; i++) {
    const title = extractTitleFromTable(tableMatches[i].tableHtml);
    if (!title || title.length < 3) continue;

    const afterTableStart = tableMatches[i].index + tableMatches[i].length;
    const bodyEnd =
      i + 1 < tableMatches.length ? tableMatches[i + 1].index : fullHtml.length;
    const bodyHtml = fullHtml.slice(afterTableStart, bodyEnd);
    const body = htmlToText(bodyHtml);

    blocks.push({ title: title.trim(), body: body.trim() });
  }

  return blocks;
}

/**
 * Parse SMR template DOCX buffer.
 * Each position = one table (first cell = title). Body = text under the table until the next table.
 */
export async function parseSmrTemplateDocx(buffer: Buffer): Promise<SmrTemplate[]> {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value ?? '';

  const blocks = splitByTables(html);

  return blocks.map((b) => ({
    title: b.title,
    body: b.body,
  }));
}
