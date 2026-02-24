/**
 * SMR template DOCX parser.
 * Reads "Шаблони СМР.docx" with mammoth, detects SMR blocks by heading/table boundaries.
 * Each block: starts at a heading (table title), continues until the next heading.
 * Returns title + body (descriptive text; table content is excluded from body).
 */

import mammoth from 'mammoth';

export type SmrTemplate = {
  title: string;
  body: string;
};

/** Strip HTML tags and decode basic entities to get plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/** Extract text from a heading tag content (may contain inner HTML) */
function extractHeadingText(html: string): string {
  return htmlToText(html);
}

/**
 * Split HTML into blocks by h1–h6. Each block: [headingHtml, contentUntilNextHeading].
 */
function splitByHeadings(html: string): Array<{ heading: string; content: string }> {
  const blocks: Array<{ heading: string; content: string }> = [];
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  const fullHtml = html.replace(/^\s+|\s+$/g, '');
  const headings: Array<{ index: number; length: number; text: string }> = [];

  while ((match = headingRegex.exec(fullHtml)) !== null) {
    headings.push({
      index: match.index,
      length: match[0].length,
      text: extractHeadingText(match[1]),
    });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : fullHtml.length;
    let content = fullHtml.slice(start, end);
    // Body = only text AFTER the first table (text under the table for this element)
    const tableCloseMatch = content.match(/<\/table\s*>/i);
    if (tableCloseMatch && tableCloseMatch.index !== undefined) {
      content = content.slice(tableCloseMatch.index + tableCloseMatch[0].length);
    }
    const body = htmlToText(content);
    if (headings[i].text) {
      blocks.push({
        heading: headings[i].text,
        content: body,
      });
    }
  }

  return blocks;
}

/**
 * Parse SMR template DOCX buffer.
 * Uses mammoth convertToHtml to preserve heading structure, then splits by headings.
 * Body = descriptive text after each heading (tables are stripped).
 */
export async function parseSmrTemplateDocx(buffer: Buffer): Promise<SmrTemplate[]> {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value ?? '';

  const blocks = splitByHeadings(html);

  return blocks.map((b) => ({
    title: b.heading,
    body: b.content.trim(),
  }));
}
