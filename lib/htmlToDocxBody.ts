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
    const srcMatch =
      imgMatch[0].match(/src="([^"]+)"/i) ??
      imgMatch[0].match(/src='([^']+)'/i);
    if (srcMatch) {
      const parsed = parseDataUri(srcMatch[1]);
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

  // Step 2: Merge standalone image-only <p> elements with the next <p>.
  // mammoth emits Word picture-bullet icons as separate <p><img/></p> paragraphs
  // instead of keeping them inline with the list item text. This transform re-joins
  // them so the icon renders inline with its text (matching the original template).
  const htmlMerged = mergeImageOnlyParagraphs(htmlNoTables);

  // Step 3: Match top-level block elements sequentially.
  const blockRegex =
    /(<p[^>]*>[\s\S]*?<\/p\s*>|<ul[^>]*>[\s\S]*?<\/ul\s*>|<ol[^>]*>[\s\S]*?<\/ol\s*>|<img[^>]*\/?>|__TABLE\d+__)/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(htmlMerged)) !== null) {
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
