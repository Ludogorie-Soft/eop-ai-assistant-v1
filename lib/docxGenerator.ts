/**
 * DOCX generator for Tender Technical document
 * Uses docx npm library
 * Font: Times New Roman 11pt, line spacing 1, headings bold
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LineRuleType,
} from 'docx';

const FONT = 'Times New Roman';
const FONT_SIZE = 22; // 11pt in half-points
const LINE_SPACING = 240; // single spacing in twips

const defaultSpacing = {
  line: LINE_SPACING,
  lineRule: LineRuleType.AT_LEAST,
  before: 200,
  after: 200,
};

/** Extract order number (номер на поръчката) from raw documentation text for filename */
export function extractOrderNumber(rawText: string): string | null {
  if (!rawText?.trim()) return null;
  const m1 = rawText.match(/номера?\s*на\s*поръчката\s*(?:е)?\s*[:\s]*([0-9A-Za-z\-]+)/i);
  if (m1?.[1]) return m1[1].trim().replace(/[^\w\-]/g, '') || null;
  const m2 = rawText.match(/поръчката\s*(\d{5}-\d{4}-\d{4})/i);
  if (m2?.[1]) return m2[1];
  const m3 = rawText.match(/референтен\s*номер\s*[:\s]*([0-9A-Za-z\-]+)/i);
  if (m3?.[1] && m3[1].trim() !== 'Непопълнено') return m3[1].trim().replace(/[^\w\-]/g, '') || null;
  const m4 = rawText.match(/(\d{5}-\d{4}-\d{4})/);
  if (m4?.[1]) return m4[1];
  return null;
}

/** Extract short main object (e.g. institution name) for filename */
export function extractMainObjectFromSubject(introductionText: string): string {
  const fullText = introductionText.replace(/\*\*/g, '');
  const blocks = fullText.split(/\n\n+/);
  const subjectBlock = blocks.find((b) =>
    /^1\.\s*Предмет\s+на\s+поръчката/i.test(b.trim())
  );
  const body = subjectBlock
    ? subjectBlock.replace(/^[\d.]+\s*[^\n]+\n?/s, '').trim()
    : fullText;

  const shortQuoted = body.match(/[„"]([^„"]{2,40})[„"]/g);
  if (shortQuoted?.length) {
    const best = shortQuoted
      .map((m) => m.replace(/^[„"]|[„"]$/g, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 30 && !/^(за|на|в|от|с|до)$/i.test(s))
      .sort((a, b) => a.length - b.length)[0];
    if (best) return sanitizeFilename(best, 25);
  }

  const institutionMatch = body.match(
    /(?:за нуждите на|възложител е|в)\s+[^,]+[„"]([^„"]{2,30})[„"]/i
  );
  if (institutionMatch?.[1]) {
    return sanitizeFilename(institutionMatch[1], 25);
  }

  return new Date().toISOString().slice(0, 10);
}

function sanitizeFilename(text: string, maxLen: number): string {
  const cleaned = text
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim();
  const truncated = cleaned.slice(0, maxLen).replace(/_$/, '');
  return truncated || 'поръчка';
}

function parseBlock(block: string): { heading: string; body: string } | null {
  const match = block.match(/^(\d+)\.\s*\*?\*?([^*\n]+)\*?\*?\s*\n?([\s\S]*)$/);
  if (match) {
    const num = match[1];
    const heading = match[2].trim();
    const body = match[3].trim();
    return { heading: `${num}. ${heading}`, body };
  }
  return null;
}

export async function generateTenderDocx(
  introductionText: string,
  rawText?: string
): Promise<{ buffer: Buffer; filename: string }> {
  const paragraphs: Paragraph[] = [];

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '1. УВОД',
          font: FONT,
          size: FONT_SIZE,
          bold: true,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      spacing: { ...defaultSpacing, after: 400 },
    })
  );

  const blocks = introductionText
    .split(/\n\n+/)
    .map((s) => s.trim().replace(/\*\*([^*]+)\*\*/g, '$1'))
    .filter((b) => {
      const t = b.replace(/\*\*/g, '').trim().toLowerCase();
      return Boolean(b) && t !== 'увод';
    });

  for (const block of blocks) {
    const parsed = parseBlock(block);

    if (parsed) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: parsed.heading,
              font: FONT,
              size: FONT_SIZE,
              bold: true,
            }),
          ],
          spacing: { ...defaultSpacing, after: 0, before: 0 },
        })
      );
      if (parsed.body) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: parsed.body,
                font: FONT,
                size: FONT_SIZE,
              }),
            ],
            spacing: { ...defaultSpacing, before: 0 },
          })
        );
      }
    } else {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: block,
              font: FONT,
              size: FONT_SIZE,
            }),
          ],
          spacing: defaultSpacing,
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(doc));
  const orderNumber = rawText ? extractOrderNumber(rawText) : null;
  const filename = orderNumber
    ? `поръчка_${orderNumber}.docx`
    : `поръчка_${extractMainObjectFromSubject(introductionText)}.docx`;

  return { buffer, filename };
}
