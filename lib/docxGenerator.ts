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
  ImageRun,
  HeadingLevel,
  AlignmentType,
  LineRuleType,
  BorderStyle,
  Table,
} from "docx";
import { htmlToDocxElements } from "./htmlToDocxBody";
import { resolveHtmlImages } from "./offerStorage";

const FONT = "Times New Roman";
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
  const m1 = rawText.match(
    /номера?\s*на\s*поръчката\s*(?:е)?\s*[:\s]*([0-9A-Za-z\-]+)/i,
  );
  if (m1?.[1]) return m1[1].trim().replace(/[^\w\-]/g, "") || null;
  const m2 = rawText.match(/поръчката\s*(\d{5}-\d{4}-\d{4})/i);
  if (m2?.[1]) return m2[1];
  const m3 = rawText.match(/референтен\s*номер\s*[:\s]*([0-9A-Za-z\-]+)/i);
  if (m3?.[1] && m3[1].trim() !== "Непопълнено")
    return m3[1].trim().replace(/[^\w\-]/g, "") || null;
  const m4 = rawText.match(/(\d{5}-\d{4}-\d{4})/);
  if (m4?.[1]) return m4[1];
  return null;
}

/** Extract short main object (e.g. institution name) for filename */
export function extractMainObjectFromSubject(introductionText: string): string {
  const fullText = introductionText.replace(/\*\*/g, "");
  const blocks = fullText.split(/\n\n+/);
  const subjectBlock = blocks.find((b) =>
    /^1\.\s*Предмет\s+на\s+поръчката/i.test(b.trim()),
  );
  const body = subjectBlock
    ? subjectBlock.replace(/^[\d.]+\s*[^\n]+\n?/s, "").trim()
    : fullText;

  const shortQuoted = body.match(/[„"]([^„"]{2,40})[„"]/g);
  if (shortQuoted?.length) {
    const best = shortQuoted
      .map((m) => m.replace(/^[„"]|[„"]$/g, "").trim())
      .filter(
        (s) =>
          s.length >= 2 && s.length <= 30 && !/^(за|на|в|от|с|до)$/i.test(s),
      )
      .sort((a, b) => a.length - b.length)[0];
    if (best) return sanitizeFilename(best, 25);
  }

  const institutionMatch = body.match(
    /(?:за нуждите на|възложител е|в)\s+[^,]+[„"]([^„"]{2,30})[„"]/i,
  );
  if (institutionMatch?.[1]) {
    return sanitizeFilename(institutionMatch[1], 25);
  }

  return new Date().toISOString().slice(0, 10);
}

function sanitizeFilename(text: string, maxLen: number): string {
  const cleaned = text
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .trim();
  const truncated = cleaned.slice(0, maxLen).replace(/_$/, "");
  return truncated || "поръчка";
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

export type SmrResultForDocx = {
  kssCode: string;
  kssName: string;
  matchedTitle: string | null;
  text: string;
  confidence: number;
  htmlBody?: string;
};


export async function generateTenderDocx(
  introductionText: string | undefined,
  rawText?: string,
  smrResults?: SmrResultForDocx[],
  satelliteImage?: { data: Buffer; width: number; height: number },
  teamOrganizationText?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const paragraphs: (Paragraph | Table)[] = [];
  const hasIntroduction = Boolean(introductionText?.trim());
  const hasTeamOrg = Boolean(teamOrganizationText?.trim());
  const hasSmr = Boolean(smrResults?.length);

  if (hasIntroduction) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "1. УВОД",
            font: FONT,
            size: FONT_SIZE,
            bold: true,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.LEFT,
        spacing: { ...defaultSpacing, after: 400 },
      }),
    );

    if (satelliteImage) {
      const maxWidth = 600;
      const scale = Math.min(1, maxWidth / satelliteImage.width);
      paragraphs.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: satelliteImage.data,
              transformation: {
                width: Math.round(satelliteImage.width * scale),
                height: Math.round(satelliteImage.height * scale),
              },
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { ...defaultSpacing, after: 400 },
        }),
      );
    }

    const blocks = (introductionText ?? "")
      .split(/\n\n+/)
      .map((s) => s.trim().replace(/\*\*([^*]+)\*\*/g, "$1"))
      .filter((b) => {
        const t = b.replace(/\*\*/g, "").trim().toLowerCase();
        return Boolean(b) && t !== "увод";
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
          }),
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
              alignment: AlignmentType.BOTH,
              spacing: { ...defaultSpacing, before: 0 },
            }),
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
            alignment: AlignmentType.BOTH,
            spacing: defaultSpacing,
          }),
        );
      }
    }
  }

  if (hasSmr && smrResults) {
    const smrSectionTitle = `${1 + (hasIntroduction ? 1 : 0)}. ТЕКСТОВЕ ЗА КСС`;
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: smrSectionTitle,
            font: FONT,
            size: FONT_SIZE,
            bold: true,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.LEFT,
        spacing: {
          ...defaultSpacing,
          before: hasIntroduction ? 400 : 0,
          after: 400,
        },
      }),
    );

    for (const r of smrResults) {
      const subheading = `${r.kssCode} – ${r.kssName}`;
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: subheading,
              font: FONT,
              size: FONT_SIZE,
              bold: true,
            }),
          ],
          spacing: { ...defaultSpacing, after: 0, before: 200 },
        }),
      );
      if (r.htmlBody) {
        // Use rich HTML body: preserves bold, italic, bullet lists, images, and tables from the SMR template.
        // Tables are rendered 1:1 as DOCX Table objects (matching the original template structure).
        const resolvedHtml = r.htmlBody.includes("/api/admin/offer-images/")
          ? await resolveHtmlImages(r.htmlBody).catch(() => r.htmlBody!)
          : r.htmlBody;
        const richElements = htmlToDocxElements(resolvedHtml);
        paragraphs.push(...richElements);
      } else {
        // No matching SMR template found — show only a text note, no table
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "Не е намерена съответстваща СМР технология в шаблона.",
                font: FONT,
                size: FONT_SIZE,
                italics: true,
                color: "888888",
              }),
            ],
            spacing: { ...defaultSpacing, before: 0 },
          }),
        );
      }
    }
  }

  if (hasTeamOrg && teamOrganizationText) {
    const sectionNum = 1 + (hasIntroduction ? 1 : 0) + (hasSmr ? 1 : 0);
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${sectionNum}. ОРГАНИЗАЦИЯ НА ЕКИПА`,
            font: FONT,
            size: FONT_SIZE,
            bold: true,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.LEFT,
        spacing: {
          ...defaultSpacing,
          before: hasIntroduction || hasSmr ? 400 : 0,
          after: 400,
        },
      }),
    );

    // Helper: horizontal rule paragraph (top border)
    const hrParagraph = () =>
      new Paragraph({
        children: [],
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: "888888", space: 1 },
        },
        spacing: { line: LINE_SPACING, lineRule: LineRuleType.AT_LEAST, before: 100, after: 200 },
      });

    // Split into individual position blocks by the ─ separator used in formatOutput
    const positionBlocks = teamOrganizationText
      .split(/─{10,}/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const positionText of positionBlocks) {
      const allLines = positionText.split('\n');
      const titleLine = allLines[0]?.trim() || '';
      if (!titleLine) continue;

      // Role title – bold with bottom border
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: titleLine, font: FONT, size: FONT_SIZE, bold: true }),
          ],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "888888", space: 1 },
          },
          spacing: { ...defaultSpacing, before: 400, after: 200 },
        }),
      );

      // Split remaining content by --- section separators
      const rest = allLines.slice(1).join('\n');
      const sectionParts = rest.split(/\n---+\n|\n---+$|^---+\n/m).map((s) => s.trim());

      for (let si = 0; si < sectionParts.length; si++) {
        const part = sectionParts[si];
        if (!part) continue;

        // Add horizontal rule before each section except the first
        if (si > 0) {
          paragraphs.push(hrParagraph());
        }

        const blocks = part.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);

        for (const block of blocks) {
          // Numbered section header – italic
          if (/^\d+\.\s/.test(block)) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({ text: block, font: FONT, size: FONT_SIZE, italics: true }),
                ],
                spacing: { ...defaultSpacing, before: 200, after: 100 },
              }),
            );
            continue;
          }

          // ✅ sub-section header – regular, preserve emoji
          if (block.startsWith('✅')) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({ text: block, font: FONT, size: FONT_SIZE }),
                ],
                spacing: { ...defaultSpacing, before: 100, after: 100 },
              }),
            );
            continue;
          }

          // All other paragraphs (including sub-headings ending with ":")
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: block, font: FONT, size: FONT_SIZE }),
              ],
              alignment: AlignmentType.BOTH,
              spacing: defaultSpacing,
            }),
          );
        }
      }
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
  let filename: string;
  if (orderNumber) {
    filename = `поръчка_${orderNumber}.docx`;
  } else if (hasIntroduction && introductionText) {
    filename = `поръчка_${extractMainObjectFromSubject(introductionText)}.docx`;
  } else {
    filename = `поръчка_КСС_${new Date().toISOString().slice(0, 10)}.docx`;
  }

  return { buffer, filename };
}
