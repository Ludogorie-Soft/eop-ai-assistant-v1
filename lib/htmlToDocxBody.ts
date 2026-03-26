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
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImportedXmlComponent,
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
  let highlight: "yellow" | undefined;

  // Tokenize: known formatting tags | any other HTML tag (skipped) | plain text.
  // The <[^>]*> catch-all is critical: without it, unknown tags like </ul> cause the
  // engine to advance past '<' and match 'ul>' as literal text.
  const tokenRegex = /<(\/?)(?:strong|em|b|i|br|mark)[^>]*>|<[^>]*>|[^<]+/gi;
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
      } else if (tagName === "mark") {
        highlight = closing ? undefined : "yellow";
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
            ...(highlight ? { highlight } : {}),
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
function getPngDimensions(buf: Buffer): { width: number; height: number } | null {
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
  return null;
}

/**
 * Extract JPEG dimensions by scanning for SOF (Start of Frame) markers.
 * SOF markers: 0xFFC0–0xFFC3, 0xFFC5–0xFFC7, 0xFFC9–0xFFCB, 0xFFCD–0xFFCF.
 * Frame header: marker(2) + length(2) + precision(1) + height(2) + width(2).
 */
function getJpgDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    let offset = 2; // skip SOI marker (0xFFD8)
    while (offset + 4 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      // SOF markers (excluding DHT 0xC4, JPG 0xC8, DAC 0xCC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (offset + 9 <= buf.length) {
          const h = buf.readUInt16BE(offset + 5);
          const w = buf.readUInt16BE(offset + 7);
          if (w > 0 && w < 10000 && h > 0 && h < 10000) {
            return { width: w, height: h };
          }
        }
        break;
      }
      // Skip to next marker: length is big-endian uint16 at offset+2
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Detect tiny bullet-icon or blank placeholder images that should be skipped.
 * - 15x15 cross icons (both dims ≤ 20px)
 * - ~140x102 blank rectangle placeholders (filesize < 500 bytes)
 */
function isPlaceholderImage(
  dims: { width: number; height: number },
  data: Buffer,
): boolean {
  if (dims.width <= 20 && dims.height <= 20) return true;
  if (data.length < 500 && dims.width <= 150 && dims.height <= 150) return true;
  return false;
}

/**
 * Get image dimensions for any supported type. Returns fallback if parsing fails.
 */
function getImageDimensions(
  type: "png" | "jpg" | "gif",
  data: Buffer,
): { width: number; height: number } {
  if (type === "png") return getPngDimensions(data) ?? { width: 400, height: 300 };
  if (type === "jpg") return getJpgDimensions(data) ?? { width: 400, height: 300 };
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
 * Verify that the image buffer starts with the expected binary signature.
 * Rejects corrupt payloads such as WMF/EMF data wrapped in an image/png MIME type,
 * which would embed broken images in the output DOCX.
 */
function isValidImageData(
  type: "png" | "jpg" | "gif",
  data: Buffer,
): boolean {
  if (data.length < 8) return false;
  switch (type) {
    case "png":
      return (
        data[0] === 0x89 &&
        data[1] === 0x50 &&
        data[2] === 0x4e &&
        data[3] === 0x47 &&
        data[4] === 0x0d &&
        data[5] === 0x0a &&
        data[6] === 0x1a &&
        data[7] === 0x0a
      );
    case "jpg":
      return data[0] === 0xff && data[1] === 0xd8;
    case "gif":
      // GIF87a or GIF89a
      return data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46;
    default:
      return false;
  }
}

/**
 * Merge standalone image-only <p> elements with the following <p> element.
 *
 * mammoth extracts Word picture-bullet lists as pairs of:
 *   <p><img .../></p>          ← bullet icon paragraph
 *   <p>item text</p>           ← list item text paragraph
 * instead of a single inline <p><img .../>item text</p>.
 *
 * Two-pass strategy:
 *   Pass 1 – replace each image-only <p>…</p> with an indexed marker
 *             __PIMG_N__ so the following <p> opening is NOT consumed and
 *             can still be independently found in later passes.
 *   Pass 2 – inject the stored img tags at the start of the next <p> body.
 *
 * Images wrapped in <span> or other elements are handled by stripping all
 * non-img tags when checking for visible text.
 */
function mergeImageOnlyParagraphs(html: string): string {
  const imgStore: string[] = [];

  // Pass 1: replace image-only paragraphs with stable inline markers.
  // Each <p>…</p> is matched independently (no next-<p> captured), so
  // consecutive image paragraphs all get individual markers.
  const marked = html.replace(
    /<p[^>]*>([\s\S]*?)<\/p\s*>/gi,
    (fullMatch, content: string) => {
      // Strip img tags, then strip all remaining HTML tags to get visible text
      const textOnly = content
        .replace(/<img[^>]*\/?>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .trim();

      if (textOnly.length > 0) return fullMatch; // has text → keep as-is

      // Extract all <img> tags (even if nested inside <span> etc.)
      const imgs = [...content.matchAll(/<img[^>]*\/?>/gi)]
        .map((m) => m[0])
        .join("");

      if (!imgs) return fullMatch; // no images → keep as-is

      const idx = imgStore.length;
      imgStore.push(imgs);
      return `__PIMG_${idx}__`;
    },
  );

  if (imgStore.length === 0) return html; // nothing to merge

  // Pass 1.5: strip whitespace-only paragraphs between markers and the next <p>.
  // mammoth sometimes emits <p> </p> or <p>&nbsp;</p> between icon and text,
  // which breaks the marker→<p> adjacency needed for Pass 2.
  let cleaned = marked.replace(
    /(__PIMG_\d+__)\s*<p[^>]*>\s*(?:&nbsp;\s*)*<\/p\s*>/gi,
    "$1",
  );

  // Pass 2: inject stored img tags at the start of the following <p> body.
  // Repeat until stable so that chained markers are all resolved.
  let prev = "";
  let curr = cleaned;
  while (prev !== curr) {
    prev = curr;
    curr = curr.replace(
      /__PIMG_(\d+)__\s*(<p[^>]*>)/gi,
      (_m, idxStr: string, nextPOpen: string) => {
        const imgs = imgStore[parseInt(idxStr, 10)] ?? "";
        return nextPOpen + imgs;
      },
    );
  }

  // Remove any remaining markers that had no following <p> (end of section)
  return curr.replace(/__PIMG_\d+__/g, "");
}

/**
 * Extract src attribute value from an <img> tag using indexOf (safe for huge base64 strings).
 */
function extractSrcAttribute(imgHtml: string): string | null {
  const lower = imgHtml.toLowerCase();
  const idx = lower.indexOf("src=");
  if (idx === -1) return null;
  const quoteChar = imgHtml[idx + 4];
  if (quoteChar !== '"' && quoteChar !== "'") return null;
  const start = idx + 5;
  const end = imgHtml.indexOf(quoteChar, start);
  if (end === -1) return null;
  return imgHtml.slice(start, end);
}

/**
 * Parse a data URI without regex (safe for huge base64 strings).
 */
function parseDataUriIterative(
  src: string,
): { type: "png" | "jpg" | "gif"; data: Buffer } | null {
  const prefix = "data:image/";
  if (!src.startsWith(prefix)) return null;
  const semiIdx = src.indexOf(";base64,");
  if (semiIdx === -1 || semiIdx > prefix.length + 10) return null;
  const ext = src.slice(prefix.length, semiIdx).toLowerCase();
  const type: "png" | "jpg" | "gif" =
    ext === "jpeg" || ext === "jpg" ? "jpg" : ext === "gif" ? "gif" : "png";
  const b64 = src.slice(semiIdx + 8);
  try {
    const data = Buffer.from(b64, "base64");
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
  const srcValue = extractSrcAttribute(imgHtml);
  if (!srcValue) return null;

  const parsed = parseDataUriIterative(srcValue);
  if (!parsed) return null;
  if (!isValidImageData(parsed.type, parsed.data)) return null;

  const raw = getImageDimensions(parsed.type, parsed.data);
  if (isPlaceholderImage(raw, parsed.data)) return null;

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
    const srcValue = extractSrcAttribute(imgMatch[0]);
    if (srcValue) {
      const parsed = parseDataUriIterative(srcValue);
      if (parsed && isValidImageData(parsed.type, parsed.data)) {
        const raw = getImageDimensions(parsed.type, parsed.data);
        if (isPlaceholderImage(raw, parsed.data)) {
          lastIndex = imgMatch.index + imgMatch[0].length;
          continue;
        }
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

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

const TABLE_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
};

/**
 * Parse an HTML `<table>` block into a docx Table object.
 * Handles colspan, bold/italic inline content in cells, and images.
 */
function parseTableBlock(tableHtml: string): (Paragraph | Table)[] {
  const rows: TableRow[] = [];

  // Extract <tr> blocks
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let trMatch: RegExpExecArray | null;

  // First pass: determine max column count (accounting for colspan)
  let maxCols = 0;
  const trMatches: string[] = [];
  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    trMatches.push(trMatch[1]);
    const cellRe = /<t[dh][^>]*>/gi;
    let cols = 0;
    let cellTag: RegExpExecArray | null;
    while ((cellTag = cellRe.exec(trMatch[1])) !== null) {
      const csMatch = cellTag[0].match(/colspan\s*=\s*["']?(\d+)/i);
      cols += csMatch ? parseInt(csMatch[1], 10) : 1;
    }
    if (cols > maxCols) maxCols = cols;
  }

  if (maxCols === 0) return [];

  for (const trContent of trMatches) {
    const cells: TableCell[] = [];
    const cellRegex = /<(t[dh])([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi;
    let cellMatch: RegExpExecArray | null;
    let colsInRow = 0;

    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      const attrs = cellMatch[2];
      const cellContent = cellMatch[3];
      const csMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
      const colspan = csMatch ? parseInt(csMatch[1], 10) : 1;
      colsInRow += colspan;

      // Parse cell content — extract inline text from nested <p> tags or raw content
      const cellChildren: Paragraph[] = [];
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p\s*>/gi;
      let pMatch: RegExpExecArray | null;
      let hasParagraphs = false;

      while ((pMatch = pRegex.exec(cellContent)) !== null) {
        hasParagraphs = true;
        const runs = parseInline(pMatch[1]);
        if (runs.length > 0) {
          cellChildren.push(
            new Paragraph({
              children: runs,
              spacing: { line: 240, lineRule: LineRuleType.AT_LEAST, before: 40, after: 40 },
            }),
          );
        }
      }

      if (!hasParagraphs) {
        // No <p> tags — parse the raw cell content directly
        const runs = parseInline(cellContent);
        if (runs.length > 0) {
          cellChildren.push(
            new Paragraph({
              children: runs,
              spacing: { line: 240, lineRule: LineRuleType.AT_LEAST, before: 40, after: 40 },
            }),
          );
        }
      }

      // Ensure at least one empty paragraph (DOCX requires non-empty cells)
      if (cellChildren.length === 0) {
        cellChildren.push(new Paragraph({ children: [] }));
      }

      cells.push(
        new TableCell({
          children: cellChildren,
          columnSpan: colspan > 1 ? colspan : undefined,
          borders: {
            top: TABLE_BORDER,
            bottom: TABLE_BORDER,
            left: TABLE_BORDER,
            right: TABLE_BORDER,
          },
        }),
      );
    }

    // Pad row if it has fewer columns than max (for rows without colspan)
    while (colsInRow < maxCols) {
      cells.push(
        new TableCell({
          children: [new Paragraph({ children: [] })],
          borders: {
            top: TABLE_BORDER,
            bottom: TABLE_BORDER,
            left: TABLE_BORDER,
            right: TABLE_BORDER,
          },
        }),
      );
      colsInRow++;
    }

    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }));
    }
  }

  if (rows.length === 0) return [];

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    }),
  ];
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
 * Body `<table>` elements are rendered as DOCX Table objects, preserving the
 * original structure (rows, cells, colspan, bold/italic formatting).
 *
 * Returns an empty array for empty/null input.
 */
export function htmlToDocxElements(
  html: string
): (Paragraph | Table | ImportedXmlComponent)[] {
  if (!html?.trim()) return [];

  // ---------------------------------------------------------------------------
  // Guard: strip base64 data URIs BEFORE any regex processing.
  // resolveHtmlImages() inlines images as data:image/...;base64,<huge payload>
  // which makes the HTML string 100KB+. V8's regex engine uses internal recursion
  // and overflows on strings this large. We extract the payloads into an array,
  // replace them with short placeholders, run all regex on the small string,
  // then restore them just before image rendering.
  // All operations here are iterative (indexOf loops) — no regex on big strings.
  // ---------------------------------------------------------------------------
  const b64Store: string[] = [];
  let safeHtml = "";
  {
    const needle = "data:image/";
    const b64Chars = new Set(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
    );
    let cur = 0;
    while (cur < html.length) {
      const i = html.indexOf(needle, cur);
      if (i === -1) { safeHtml += html.slice(cur); break; }
      safeHtml += html.slice(cur, i);
      const semi = html.indexOf(";base64,", i);
      if (semi === -1 || semi - i > 40) {
        // Not a real data URI — keep literal prefix and advance
        safeHtml += needle;
        cur = i + needle.length;
        continue;
      }
      let end = semi + 8; // past ";base64,"
      while (end < html.length && b64Chars.has(html[end])) end++;
      b64Store.push(html.slice(i, end));
      safeHtml += `__B64_${b64Store.length - 1}__`;
      cur = end;
    }
  }

  // Iterative restore — also avoids regex on strings containing huge base64
  const restoreB64 = (s: string): string => {
    if (b64Store.length === 0) return s;
    let out = "";
    let cur = 0;
    const tag = "__B64_";
    while (cur < s.length) {
      const i = s.indexOf(tag, cur);
      if (i === -1) { out += s.slice(cur); break; }
      out += s.slice(cur, i);
      let ne = i + tag.length;
      while (ne < s.length && s[ne] >= "0" && s[ne] <= "9") ne++;
      if (s.slice(ne, ne + 2) === "__") {
        out += b64Store[parseInt(s.slice(i + tag.length, ne), 10)] ?? "";
        cur = ne + 2;
      } else {
        out += tag;
        cur = i + tag.length;
      }
    }
    return out;
  };

  const elements: (Paragraph | Table | ImportedXmlComponent)[] = [];

  // Step 0: Extract <div data-docx-drawing="…"> blocks before other processing.
  // These carry self-contained DrawingML XML (wpg drawing groups) encoded as
  // base64 in the attribute.  We lift them out to avoid confusing the table /
  // paragraph parsers, then inject them as ImportedXmlComponent paragraphs.
  const drawingStore: string[] = []; // index → raw XML block
  let htmlNoDrawings = "";
  {
    const DRAW_OPEN = '<div data-docx-drawing="';
    const DRAW_CLOSE = '"></div>';
    let cur = 0;
    while (cur < safeHtml.length) {
      const openIdx = safeHtml.indexOf(DRAW_OPEN, cur);
      if (openIdx === -1) { htmlNoDrawings += safeHtml.slice(cur); break; }
      htmlNoDrawings += safeHtml.slice(cur, openIdx);
      const b64Start = openIdx + DRAW_OPEN.length;
      const b64End = safeHtml.indexOf(DRAW_CLOSE, b64Start);
      if (b64End === -1) { htmlNoDrawings += safeHtml.slice(openIdx); break; }
      const b64 = safeHtml.slice(b64Start, b64End);
      drawingStore.push(b64);
      htmlNoDrawings += `__DRAWING${drawingStore.length - 1}__`;
      cur = b64End + DRAW_CLOSE.length;
    }
  }

  // Step 1: Extract <table> blocks (iterative — safe for large strings)
  const tableBlocks: string[] = [];
  let htmlNoTables = "";
  {
    let cur = 0;
    const lower = htmlNoDrawings.toLowerCase();
    while (cur < htmlNoDrawings.length) {
      const openIdx = lower.indexOf("<table", cur);
      if (openIdx === -1) { htmlNoTables += htmlNoDrawings.slice(cur); break; }
      htmlNoTables += htmlNoDrawings.slice(cur, openIdx);
      const closeIdx = lower.indexOf("</table", openIdx + 6);
      if (closeIdx === -1) { htmlNoTables += htmlNoDrawings.slice(openIdx); break; }
      const closeEnd = htmlNoDrawings.indexOf(">", closeIdx + 7);
      const tableEnd = closeEnd === -1 ? closeIdx + 8 : closeEnd + 1;
      tableBlocks.push(htmlNoDrawings.slice(openIdx, tableEnd));
      htmlNoTables += `__TABLE${tableBlocks.length - 1}__`;
      cur = tableEnd;
    }
  }

  // Step 2: Merge standalone image-only <p> elements with the next <p>.
  const htmlMerged = mergeImageOnlyParagraphs(htmlNoTables);

  // Step 3: Match top-level block elements sequentially.
  // Safe now — safeHtml has short placeholders instead of huge base64 payloads.
  const blockRegex =
    /(<p[^>]*>[\s\S]*?<\/p\s*>|<ul[^>]*>[\s\S]*?<\/ul\s*>|<ol[^>]*>[\s\S]*?<\/ol\s*>|<img[^>]*\/?>|__TABLE\d+__|__DRAWING\d+__)/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(htmlMerged)) !== null) {
    // Restore base64 before content parsing (images need real data URIs)
    const block = restoreB64(match[0]);

    if (/^<p/i.test(block)) {
      elements.push(...parseParagraphBlock(block));
    } else if (/^<ul|^<ol/i.test(block)) {
      elements.push(...parseListBlock(block));
    } else if (/^<img/i.test(block)) {
      const imgPara = imgToParagraph(block);
      if (imgPara) elements.push(imgPara);
    } else if (/^__DRAWING\d+__$/.test(block)) {
      const dIdx = parseInt(block.replace(/^__DRAWING(\d+)__$/, "$1"), 10);
      const b64 = drawingStore[dIdx];
      if (b64) {
        try {
          const drawingXml = Buffer.from(b64, "base64").toString("utf-8");
          // Wrap the mc:AlternateContent block in a <w:p> with all necessary
          // namespace declarations so it is valid as a standalone XML fragment.
          const wrappedXml =
            `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
            ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"` +
            ` xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"` +
            ` xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"` +
            ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"` +
            ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
            ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
            ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
            ` xmlns:v="urn:schemas-microsoft-com:vml"` +
            ` xmlns:o="urn:schemas-microsoft-com:office:office">` +
            drawingXml +
            `</w:p>`;
          elements.push(ImportedXmlComponent.fromXmlString(wrappedXml) as unknown as ImportedXmlComponent);
        } catch {
          // If injection fails, skip silently rather than break the whole export
        }
      }
    } else if (/^__TABLE\d+__$/.test(block)) {
      const tIdx = parseInt(block.replace(/^__TABLE(\d+)__$/, "$1"), 10);
      const tHtml = restoreB64(tableBlocks[tIdx] ?? "");
      if (tHtml) {
        const tableElements = parseTableBlock(tHtml);
        if (tableElements.length > 0) {
          elements.push(...tableElements);
        } else {
          // Fallback: extract embedded images if table parsing yielded nothing
          for (const m of tHtml.matchAll(/<img[^>]*\/?>/gi)) {
            const imgPara = imgToParagraph(m[0]);
            if (imgPara) elements.push(imgPara);
          }
        }
      }
    }
  }

  return elements;
}
