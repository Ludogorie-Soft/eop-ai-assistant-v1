/**
 * Parser for complete Offer DOCX files (Технически Предложения).
 *
 * Flow:
 * 1. mammoth converts DOCX → HTML, images are intercepted and given a content hash
 * 2. HTML has <img src="OFFER_IMG:[hash.ext]"> placeholders
 * 3. AI identifies high-level section starts (intro, smr block, team, comm) from heading candidates
 * 4. HTML is split at those positions using TEXT SEARCH (not ratio) for accuracy
 * 5. The combined SMR HTML is further split into individual technology tables by pattern matching
 * 6. Each individual SMR table → separate offer_section row (for RAG matching)
 *
 * Section types: 'introduction' | 'smr_technology' | 'team_organization' | 'communication' | 'other'
 */

import mammoth from "mammoth";
import { createHash } from "crypto";
import { createLLM } from "./langchainClient";
import { ChatPromptTemplate } from "@langchain/core/prompts";

export type OfferSectionType =
  | "introduction"
  | "smr_technology"
  | "team_organization"
  | "communication"
  | "other";

export interface ParsedOfferSection {
  section_type: OfferSectionType;
  title: string;
  html_content: string; // <img src="OFFER_IMG:[hash.ext]"> before storage upload
  plain_text: string;
  order_index: number;
}

/** Map of content-hash → { data, mimeType } for all images extracted from the offer */
export type OfferImageMap = Map<string, { data: Buffer; mimeType: string }>;

// ─── Plain-text conversion ─────────────────────────────────────────────────

/** Strip HTML tags and decode common entities, preserving newlines from block elements */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/?(p|h[1-6]|br|tr|li|div|blockquote|hr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Heading extraction ────────────────────────────────────────────────────

interface HeadingCandidate {
  text: string;
  offset: number;
}

function extractHeadingCandidates(plainText: string): HeadingCandidate[] {
  const lines = plainText.split("\n");
  const candidates: HeadingCandidate[] = [];
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isNumberedHeading = /^(\d{1,2}\.(\d{1,2}\.?)?\s+|[IVXivx]+\.\s+)/.test(trimmed);
    const isAllCapsHeading =
      trimmed.length >= 4 &&
      trimmed.length <= 120 &&
      trimmed === trimmed.toUpperCase() &&
      /[А-ЯA-Z]/.test(trimmed) &&
      !/^\d/.test(trimmed);
    const isShortTitle =
      trimmed.length >= 5 &&
      trimmed.length <= 120 &&
      !trimmed.includes("  ") &&
      !/[.]{2,}/.test(trimmed) &&
      !/^\d+[,.]?\d*\s*(бр|м|кв|куб|лв|кг|т|мм|см|km|m²|m³|%|дни|год|мес)?\.?\s*$/.test(trimmed);

    const isCandidate =
      trimmed.length >= 3 &&
      (isNumberedHeading || isAllCapsHeading || isShortTitle) &&
      !/^\d+$/.test(trimmed);

    if (isCandidate) candidates.push({ text: trimmed, offset });
    offset += line.length + 1;
  }

  const numbered = candidates.filter((c) => /^(\d{1,2}\.|\d{1,2}\.\d)/.test(c.text));
  const allCaps = candidates.filter(
    (c) => !numbered.includes(c) && c.text === c.text.toUpperCase() && /[А-ЯA-Z]{3}/.test(c.text)
  );
  const rest = candidates.filter((c) => !numbered.includes(c) && !allCaps.includes(c));

  const seen = new Set<string>();
  return [...numbered, ...allCaps, ...rest]
    .filter((c) => {
      if (seen.has(c.text)) return false;
      seen.add(c.text);
      return true;
    })
    .slice(0, 500);
}

// ─── AI section identification ─────────────────────────────────────────────

interface AiSection {
  type: OfferSectionType;
  title: string;
  offset: number;
}

const SECTION_SYSTEM_PROMPT = `Ти си AI асистент за анализ на технически предложения за обществени поръчки в България.
Трябва да идентифицираш САМО основните блокове на документа.

Типовете секции:
- "introduction" — увод, описание на обекта/поръчката, цели (обикновено е в началото)
- "smr_technology" — ЦЕЛИЯТ блок със строително-монтажни работи, технологии и ресурси (САМО ЕДНО начало за ВСИЧКИ СМР позиции)
- "team_organization" — организация на екипа, персонал, ключови експерти
- "communication" — комуникация, отчетност, координация
- "other" — заключение, съдържание, и т.н.

КРИТИЧНО: За "smr_technology" върни САМО ЕДИН запис — началото на ЦЕЛИЯ СМР блок.
НЕ разбивай отделните строителни технологии на отделни секции!`;

const SECTION_USER_PROMPT = `Анализирай следния списък от заглавия/редове и идентифицирай ОСНОВНИТЕ блокове.

За всяка секция върни JSON обект с:
- "type": типа (introduction/smr_technology/team_organization/communication/other)
- "title": точното заглавие от списъка
- "offset": числото в [] пред заглавието

ВАЖНО:
- "smr_technology" = САМО ЕДНО начало за ЦЕЛИЯ блок с технологии (не отделни технологии!)
- Ако няма явен увод, използвай offset 0
- Игнорирай таблични данни

Върни САМО валиден JSON масив. Пример:
[
  {{"type":"introduction","title":"ПРЕДМЕТ НА ПОРЪЧКАТА","offset":1200}},
  {{"type":"smr_technology","title":"СТРОИТЕЛНО-МОНТАЖНИ РАБОТИ","offset":45000}},
  {{"type":"team_organization","title":"Организация на екипа","offset":380000}}
]

Заглавия от документа:
{headings}`;

async function identifySectionsWithAi(
  plainText: string,
  headingCandidates: HeadingCandidate[]
): Promise<AiSection[]> {
  const llm = createLLM({ temperature: 0, maxTokens: 4096 });

  const headingsList = headingCandidates
    .map((h) => `[${h.offset}] ${h.text}`)
    .join("\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SECTION_SYSTEM_PROMPT],
    ["human", SECTION_USER_PROMPT],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({ headings: headingsList });
  const content = typeof response.content === "string" ? response.content : "";

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [{ type: "other", title: "Цялото съдържание", offset: 0 }];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      type: string;
      title: string;
      offset?: number;
    }>;

    const valid = parsed
      .filter(
        (s) =>
          s.type &&
          s.title &&
          ["introduction", "smr_technology", "team_organization", "communication", "other"].includes(s.type)
      )
      .map((s) => ({
        type: s.type as OfferSectionType,
        title: s.title,
        offset: typeof s.offset === "number" ? s.offset : 0,
      }));

    // Deduplicate: if multiple smr_technology entries, keep only the first
    const seen = new Set<OfferSectionType>();
    return valid.filter((s) => {
      if (s.type === "smr_technology" && seen.has("smr_technology")) return false;
      seen.add(s.type);
      return true;
    });
  } catch {
    return [{ type: "other", title: "Цялото съдържание", offset: 0 }];
  }
}

// ─── HTML splitting (text-search based) ───────────────────────────────────

/**
 * Find the HTML position of a plain-text title by searching for its key words.
 * Much more accurate than the ratio-based approach for table-heavy documents.
 */
function findTitleInHtml(html: string, title: string, searchFrom = 0): number {
  // Direct substring search (works when mammoth preserves text verbatim)
  const direct = html.indexOf(title, searchFrom);
  if (direct !== -1) return direct;

  // Try first 6 significant words (handles minor whitespace differences)
  const words = title
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6);

  if (words.length === 0) return -1;

  // Search for 3-word window with possible HTML tags between words
  for (let i = 0; i <= words.length - 3; i++) {
    const pattern = words
      .slice(i, i + 3)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]{0,80}");
    try {
      const re = new RegExp(pattern, "i");
      const match = html.slice(searchFrom).match(re);
      if (match?.index !== undefined) return searchFrom + match.index;
    } catch {
      // Invalid regex — continue
    }
  }

  return -1;
}

function splitHtmlBySections(
  fullHtml: string,
  sectionList: AiSection[]
): ParsedOfferSection[] {
  if (sectionList.length === 0) {
    return [
      {
        section_type: "other",
        title: "Цялото съдържание",
        html_content: fullHtml.slice(0, 1_000_000),
        plain_text: htmlToPlainText(fullHtml).slice(0, 200_000),
        order_index: 0,
      },
    ];
  }

  // Resolve HTML positions using text search, falling back to ratio
  const totalHtmlLen = fullHtml.length;
  const htmlPositions: number[] = [];
  let searchFrom = 0;

  for (let i = 0; i < sectionList.length; i++) {
    const s = sectionList[i];
    let pos = findTitleInHtml(fullHtml, s.title, searchFrom);

    if (pos === -1 || (i > 0 && pos <= htmlPositions[i - 1])) {
      // Fallback: use a small search window around the expected ratio position
      const ratioPos = Math.floor((s.offset / Math.max(1, htmlToPlainText(fullHtml).length)) * totalHtmlLen);
      const windowStart = Math.max(searchFrom, ratioPos - 20_000);
      pos = findTitleInHtml(fullHtml, s.title, windowStart);
      if (pos === -1 || (i > 0 && pos <= htmlPositions[i - 1])) {
        pos = i === 0 ? 0 : htmlPositions[i - 1] + 1;
      }
    }

    htmlPositions.push(pos);
    searchFrom = pos + 1;
  }

  const result: ParsedOfferSection[] = [];

  for (let i = 0; i < sectionList.length; i++) {
    const start = htmlPositions[i];
    const end = i + 1 < htmlPositions.length ? htmlPositions[i + 1] : totalHtmlLen;
    // No artificial 800KB cap here — SMR sections can be large
    const sectionHtml = fullHtml.slice(start, end).trim();
    const sectionPlain = htmlToPlainText(sectionHtml).slice(0, 500_000);

    if (sectionPlain.length < 50) continue;

    result.push({
      section_type: sectionList[i].type,
      title: sectionList[i].title,
      html_content: sectionHtml,
      plain_text: sectionPlain,
      order_index: i,
    });
  }

  return result;
}

// ─── Individual SMR technology extraction ────────────────────────────────

/**
 * Detect individual SMR technology tables from the combined SMR section HTML.
 * Each SMR technology in the offer is a <table> that contains rows with the
 * Bulgarian phrases "Ангажирани строителни лица" and/or "Технически ресурси".
 * The first cell of the table holds the technology name (bold italic header).
 */
/**
 * Extract individual SMR technology entries from the combined SMR section HTML.
 *
 * Each entry starts at an SMR-type table (containing the resource rows) and runs
 * until the start of the NEXT SMR-type table (or end of section).
 * This captures the header table + all following text, images, and sub-tables
 * for that technology position — exactly as it appeared in the original offer.
 */
function extractSmrTechnologies(
  smrHtml: string
): { name: string; html: string; plainText: string }[] {
  // Find start positions of ALL <table> elements in the HTML
  const tableStartRe = /<table(?:\s[^>]*)?>/gi;
  const allTableStarts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableStartRe.exec(smrHtml)) !== null) {
    allTableStarts.push(m.index);
  }

  // Identify which table starts are SMR-type tables
  // (look at first 3000 chars of each table for the Bulgarian key phrases)
  const smrStarts: { index: number; name: string }[] = [];

  // Patterns for sub-tables that appear WITHIN a technology section
  // (expert/role/responsibility tables) — these are NOT new SMR technologies
  const subTablePatterns = [
    /роля\s+(на\s+)?отговорн/i,
    /експерт\s*[\/\\|,]\s*(длъжност|роля)/i,
    /длъжност\s*[\/\\|,]\s*експерт/i,
    /^(№|No\.?|#)\s*$/i,
    /^отговорност/i,
    /^експерт$/i,
    /^длъжност$/i,
    /^задача$/i,
    /^клас\s+на\s+улицата$/i,
    /^коефициент$/i,
    /^етап$/i,
    /^категория\s+персонал/i,
  ];

  for (const pos of allTableStarts) {
    const preview = smrHtml.slice(pos, pos + 4000);
    const previewLower = preview.toLowerCase();

    // Count how many of the 4 SMR resource keywords appear in this table.
    // A genuine SMR header table contains multiple resource rows (Ангажирани
    // строителни лица, Технически ресурси, Механизация), so at least 2
    // keywords must be present to avoid false positives from expert/role tables.
    let kwCount = 0;
    if (previewLower.includes("ангажирани")) kwCount++;
    if (previewLower.includes("строителни лица")) kwCount++;
    if (previewLower.includes("технически ресурси")) kwCount++;
    if (previewLower.includes("механизация")) kwCount++;

    if (kwCount < 2) continue;

    // Extract technology name from the FIRST cell of this table
    // (the merged header cell contains the technology name — bold/italic in original)
    const firstCellMatch = preview.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i);
    const rawName = firstCellMatch ? htmlToPlainText(firstCellMatch[1]).trim() : "";

    // Skip tables whose first cell looks like a sub-table header (expert/role tables)
    if (rawName && subTablePatterns.some((re) => re.test(rawName))) continue;

    const name =
      rawName.length > 3 && rawName.length < 300
        ? rawName
        : `СМР технология ${smrStarts.length + 1}`;

    smrStarts.push({ index: pos, name });
  }

  if (smrStarts.length === 0) return [];

  // For each SMR table start, capture EVERYTHING until the next SMR table start
  // This includes the table itself + all following paragraphs, images, sub-tables
  const result: { name: string; html: string; plainText: string }[] = [];

  for (let i = 0; i < smrStarts.length; i++) {
    const start = smrStarts[i].index;
    const end = i + 1 < smrStarts.length ? smrStarts[i + 1].index : smrHtml.length;
    const html = smrHtml.slice(start, end).trim();
    const plainText = htmlToPlainText(html).trim();

    if (plainText.length < 20) continue;

    result.push({ name: smrStarts[i].name, html, plainText });
  }

  return result;
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Main entry point: parse a DOCX buffer and extract typed sections + image map.
 *
 * The smr_technology section is split into ONE row per individual technology table.
 * Other sections (introduction, team_organization, communication) remain as single rows.
 *
 * Images are extracted with content hashes and stored as OFFER_IMG:[hash.ext] placeholders.
 * The caller (offerStorage.ts) uploads the imageMap to Supabase Storage.
 */
export async function parseOfferDocx(
  buffer: Buffer
): Promise<{ sections: ParsedOfferSection[]; imageMap: OfferImageMap }> {
  const imageMap: OfferImageMap = new Map();

  // Step 1: mammoth DOCX → HTML with images as hashed placeholders
  const { value: fullHtml } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const data = Buffer.from(await image.read());
        const ext =
          image.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
        const hash = createHash("sha1")
          .update(data)
          .digest("hex")
          .slice(0, 16);
        const key = `${hash}.${ext}`;
        if (!imageMap.has(key)) {
          imageMap.set(key, { data, mimeType: image.contentType });
        }
        return { src: `OFFER_IMG:${key}` };
      }),
    }
  );

  // Step 2: Extract full plain text
  const fullPlainText = htmlToPlainText(fullHtml);
  if (fullPlainText.length < 100) {
    throw new Error("Документът е твърде кратък или не може да бъде прочетен.");
  }

  // Step 3: Heading candidates → AI identifies high-level section starts
  const headingCandidates = extractHeadingCandidates(fullPlainText);
  const aiSections = await identifySectionsWithAi(fullPlainText, headingCandidates);

  // Step 4: Split HTML using text search (accurate for table-heavy documents)
  const highLevelSections = splitHtmlBySections(fullHtml, aiSections);

  // Step 5: Trim introduction — cut before "В изпълнение на задълженията"
  // (standard contract obligations block A.1–A.17, Б, В, НОРМАТИВИ that must not
  // be part of the intro section)
  for (const section of highLevelSections) {
    if (section.section_type !== "introduction") continue;
    const cutPhrase = "В изпълнение на задълженията";
    const plainIdx = section.plain_text.indexOf(cutPhrase);
    if (plainIdx === -1 || plainIdx < 200) continue; // not found or too early

    const htmlIdx = findTitleInHtml(section.html_content, cutPhrase);
    if (htmlIdx > 0) {
      section.html_content = section.html_content.slice(0, htmlIdx).trim();
      section.plain_text = htmlToPlainText(section.html_content).slice(0, 500_000);
    }
  }

  // Step 6: Expand smr_technology sections into individual technology tables
  const finalSections: ParsedOfferSection[] = [];
  let orderIndex = 0;

  for (const section of highLevelSections) {
    if (section.section_type !== "smr_technology") {
      finalSections.push({ ...section, order_index: orderIndex++ });
      continue;
    }

    // Extract individual SMR technology tables from this section's HTML
    const smrTables = extractSmrTechnologies(section.html_content);

    if (smrTables.length === 0) {
      // No individual tables found — keep as-is
      finalSections.push({ ...section, order_index: orderIndex++ });
    } else {
      for (const t of smrTables) {
        finalSections.push({
          section_type: "smr_technology",
          title: t.name,
          html_content: t.html,
          plain_text: t.plainText,
          order_index: orderIndex++,
        });
      }
    }
  }

  // Fallback: if nothing was found, return whole document as 'other'
  if (finalSections.length === 0) {
    finalSections.push({
      section_type: "other",
      title: "Цялото съдържание",
      html_content: fullHtml.slice(0, 1_000_000),
      plain_text: fullPlainText.slice(0, 500_000),
      order_index: 0,
    });
  }

  return { sections: finalSections, imageMap };
}
