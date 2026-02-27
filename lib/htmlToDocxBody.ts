/**
 * Convert mammoth-generated HTML body to docx Paragraph[].
 * Handles: <p>, <ul><li>, <ol><li>, inline <strong>/<em>, <img src="data:...;base64,..."/>, <table>.
 * Images are decoded from base64 and embedded as ImageRun.
 * Tables are rendered as plain pipe-separated text paragraphs (simple enough for resource rows).
 * Server-side only.
 */

import {
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  LineRuleType,
} from "docx";

const FONT = "Times New Roman";
const FONT_SIZE = 22; // 11pt in half-points

const defaultSpacing = {
  line: 240,
  lineRule: LineRuleType.AT_LEAST,
  before: 100,
  after: 100,
};

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

// ---------------------------------------------------------------------------
// Inline parsing: <strong>, <em>, <b>, <i>, <br>, text
// ---------------------------------------------------------------------------

/**
 * Parse inline HTML to TextRun[].
 * Supports nested bold/italic. <br> becomes a line-break TextRun.
 * Images inside <p> are stripped (caller handles them separately).
 */
function parseInline(html: string): TextRun[] {
  const runs: TextRun[] = [];
  // Remove <img> tags — images are handled at block level
  const clean = html.replace(/<img[^>]*\/?>/gi, "");

  let bold = false;
  let italic = false;

  // Tokenize: known formatting tags | any other HTML tag (skipped) | plain text.
  // The <[^>]*> catch-all is critical: without it, unknown tags like </ul> cause the
  // engine to advance past '<' and match 'ul>' as literal text.
  const tokenRegex = /<(\/?)(?:strong|em|b|i|br)[^>]*>|<[^>]*>|[^<]+/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(clean)) !== null) {
    const token = match[0];

    if (token.startsWith("<")) {
      const closing = token.charAt(1) === "/";
      const tagName = token.match(/<\/?(\w+)/)?.[1]?.toLowerCase() ?? "";

      if (tagName === "br") {
        runs.push(new TextRun({ break: 1 }));
      } else if (tagName === "strong" || tagName === "b") {
        bold = !closing;
      } else if (tagName === "em" || tagName === "i") {
        italic = !closing;
      }
    } else {
      const text = decodeEntities(token);
      if (text) {
        runs.push(
          new TextRun({
            text,
            font: FONT,
            size: FONT_SIZE,
            bold,
            italics: italic,
          }),
        );
      }
    }
  }

  return runs;
}

// ---------------------------------------------------------------------------
// Image parsing
// ---------------------------------------------------------------------------

/**
 * Extract PNG dimensions from raw buffer.
 * PNG: 8-byte signature, IHDR chunk starts at offset 8.
 * Width at bytes 16–19, height at bytes 20–23 (big-endian uint32).
 */
function getPngDimensions(buf: Buffer): { width: number; height: number } {
  try {
    if (buf.length >= 24) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 0 && w < 10000 && h > 0 && h < 10000) {
        return { width: w, height: h };
      }
    }
  } catch {
    /* ignore */
  }
  return { width: 400, height: 300 };
}

function scaleToMaxWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Parse a data URI src into typed buffer, or null if unsupported/malformed.
 */
function parseDataUri(
  src: string,
): { type: "png" | "jpg" | "gif"; data: Buffer } | null {
  const m = src.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  const type: "png" | "jpg" | "gif" =
    ext === "jpeg" || ext === "jpg" ? "jpg" : ext === "gif" ? "gif" : "png";
  try {
    const data = Buffer.from(m[2], "base64");
    return { type, data };
  } catch {
    return null;
  }
}

/**
 * Convert a single <img ...> HTML element to a centered Paragraph containing an ImageRun.
 * Returns null if src is missing or not a data URI.
 */
function imgToParagraph(imgHtml: string): Paragraph | null {
  const srcMatch =
    imgHtml.match(/src="([^"]+)"/i) ?? imgHtml.match(/src='([^']+)'/i);
  if (!srcMatch) return null;

  const parsed = parseDataUri(srcMatch[1]);
  if (!parsed) return null;

  const raw =
    parsed.type === "png"
      ? getPngDimensions(parsed.data)
      : { width: 400, height: 300 };

  const dims = scaleToMaxWidth(raw.width, raw.height, 500);

  return new Paragraph({
    children: [
      new ImageRun({
        type: parsed.type,
        data: parsed.data,
        transformation: { width: dims.width, height: dims.height },
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { ...defaultSpacing, before: 200, after: 200 },
  });
}

// ---------------------------------------------------------------------------
// Block-level parsing helpers
// ---------------------------------------------------------------------------

function parseParagraphBlock(pHtml: string): Paragraph[] {
  const inner = pHtml.replace(/^<p[^>]*>/i, "").replace(/<\/p\s*>$/i, "");

  const imgTagRe = /<img[^>]*\/?>/gi;
  const imgTags = [...inner.matchAll(imgTagRe)];

  if (imgTags.length === 0) {
    const runs = parseInline(inner);
    if (runs.length === 0) return [];
    return [
      new Paragraph({
        children: runs,
        alignment: AlignmentType.BOTH,
        spacing: defaultSpacing,
      }),
    ];
  }

  // Check whether there is any non-image text content
  const textOnly = inner.replace(/<img[^>]*\/?>/gi, "");
  const testRuns = parseInline(textOnly);
  const hasText = testRuns.some((r) =>
    (r as unknown as { text?: string }).text?.trim(),
  );

  if (!hasText) {
    // Image(s) only — render each as a centred standalone paragraph
    return imgTags.flatMap((m) => {
      const p = imgToParagraph(m[0]);
      return p ? [p] : [];
    });
  }

  // Mixed content (inline icon + text) — render in document order as one paragraph
  const children: (TextRun | ImageRun)[] = [];
  let lastIndex = 0;
  const imgRegex = /<img[^>]*\/?>/gi;
  let imgMatch: RegExpExecArray | null;

  while ((imgMatch = imgRegex.exec(inner)) !== null) {
    if (imgMatch.index > lastIndex) {
      children.push(...parseInline(inner.slice(lastIndex, imgMatch.index)));
    }
    const srcMatch =
      imgMatch[0].match(/src="([^"]+)"/i) ??
      imgMatch[0].match(/src='([^']+)'/i);
    if (srcMatch) {
      const parsed = parseDataUri(srcMatch[1]);
      if (parsed) {
        const raw =
          parsed.type === "png"
            ? getPngDimensions(parsed.data)
            : { width: 20, height: 20 };
        const dims = scaleToMaxWidth(raw.width, raw.height, 400);
        children.push(
          new ImageRun({
            type: parsed.type,
            data: parsed.data,
            transformation: { width: dims.width, height: dims.height },
          }),
        );
      }
    }
    lastIndex = imgMatch.index + imgMatch[0].length;
  }
  if (lastIndex < inner.length) {
    children.push(...parseInline(inner.slice(lastIndex)));
  }

  if (children.length === 0) return [];
  return [
    new Paragraph({
      children,
      alignment: AlignmentType.BOTH,
      spacing: defaultSpacing,
    }),
  ];
}

function parseListBlock(listHtml: string): Paragraph[] {
  const items = [...listHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li\s*>/gi)];
  return items.flatMap((item) => {
    const runs = parseInline(item[1]);
    if (runs.length === 0) return [];
    return [
      new Paragraph({
        children: runs,
        bullet: { level: 0 },
        spacing: { ...defaultSpacing, before: 60, after: 60 },
      }),
    ];
  });
}

function parseTableBlock(tableHtml: string): Paragraph[] {
  // Extract rows, render each row's cells as "cell1 | cell2 | ..." plain text
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  return rows.flatMap((row) => {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)];
    const cellTexts = cells
      .map((c) => decodeEntities(stripTags(c[1])).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (cellTexts.length === 0) return [];
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: cellTexts.join(" | "),
            font: FONT,
            size: FONT_SIZE,
          }),
        ],
        spacing: defaultSpacing,
      }),
    ];
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Convert a mammoth-generated HTML body string to an array of docx Paragraphs.
 *
 * Handles:
 *  - `<p>` with inline bold/italic/images
 *  - `<ul>/<ol><li>` as bullet paragraphs
 *  - standalone `<img src="data:...">` as centered ImageRun paragraphs
 *
 * Body `<table>` elements are intentionally SKIPPED. SMR templates often contain
 * decision-tree / flowchart tables whose cell text (да/не/?) produces garbage when
 * rendered as plain text. The meaningful spec content is always in <p> / <ul>.
 *
 * Returns an empty array for empty/null input.
 */
export function htmlToDocxElements(html: string): Paragraph[] {
  if (!html?.trim()) return [];

  const elements: Paragraph[] = [];

  // Step 1: Extract all <table> blocks and replace with stable placeholders.
  // This prevents the main block regex from partially matching nested table content.
  const tableBlocks: string[] = [];
  const htmlNoTables = html.replace(/<table[\s\S]*?<\/table\s*>/gi, (match) => {
    tableBlocks.push(match);
    return `__TABLE${tableBlocks.length - 1}__`;
  });

  // Step 2: Match top-level block elements sequentially.
  const blockRegex =
    /(<p[^>]*>[\s\S]*?<\/p\s*>|<ul[^>]*>[\s\S]*?<\/ul\s*>|<ol[^>]*>[\s\S]*?<\/ol\s*>|<img[^>]*\/?>|__TABLE\d+__)/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(htmlNoTables)) !== null) {
    const block = match[0];

    if (/^<p/i.test(block)) {
      elements.push(...parseParagraphBlock(block));
    } else if (/^<ul|^<ol/i.test(block)) {
      elements.push(...parseListBlock(block));
    } else if (/^<img/i.test(block)) {
      const imgPara = imgToParagraph(block);
      if (imgPara) elements.push(imgPara);
    } else if (/^__TABLE\d+__$/.test(block)) {
      // Decision-tree cell text (да/не/?) is skipped, but embedded images are kept.
      const tIdx = parseInt(block.replace(/^__TABLE(\d+)__$/, "$1"), 10);
      const tHtml = tableBlocks[tIdx];
      if (tHtml) {
        for (const m of tHtml.matchAll(/<img[^>]*\/?>/gi)) {
          const imgPara = imgToParagraph(m[0]);
          if (imgPara) elements.push(imgPara);
        }
      }
    }
  }

  return elements;
}
