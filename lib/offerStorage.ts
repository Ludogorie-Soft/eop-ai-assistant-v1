/**
 * Supabase storage and DB operations for complete offer uploads.
 * Bucket: offer-uploads (original DOCX files + extracted images under images/)
 * Tables: offer_uploads (metadata), offer_sections (extracted sections + embeddings)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ParsedOfferSection, OfferImageMap } from "./offerParser";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, LineRuleType } from "docx";

const BUCKET = "offer-uploads";
const IMAGES_PREFIX = "images/";
const OFFER_IMG_RE = /OFFER_IMG:([^"']+)/g;
const OFFER_IMG_URL_RE = /\/api\/admin\/offer-images\/([^"'\s]+)/g;

const CYR_TO_LAT: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ж: "Zh", З: "Z",
  И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P",
  Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "H", Ц: "Ts", Ч: "Ch",
  Ш: "Sh", Щ: "Sht", Ъ: "A", Ь: "Y", Ю: "Yu", Я: "Ya",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

function transliterate(text: string): string {
  return text.replace(/./g, (ch) => CYR_TO_LAT[ch] ?? ch);
}

function getClient(): SupabaseClient {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const key = (rawKey ?? "").trim().replace(/^["']|["']$/g, "");
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  return createClient(url, key);
}

export interface OfferInfo {
  id: string;
  name: string;
  filename: string;
  storage_path: string;
  file_size: number;
  section_count: number;
  created_at: string;
}

export interface OfferSectionRecord {
  id: string;
  offer_id: string;
  section_type: string;
  title: string;
  html_content: string;
  plain_text: string;
  order_index: number;
  created_at: string;
}

/** Upload the original DOCX to Supabase Storage */
async function uploadDocxToStorage(
  filename: string,
  buffer: Buffer
): Promise<string> {
  const client = getClient();
  const date = new Date().toISOString().slice(0, 10);
  const latinName = transliterate(filename);
  const safeName = latinName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${date}_${safeName}`;

  const { error } = await client.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/**
 * Upload each image from the map to Storage.
 * Returns a hash-key → API URL lookup map.
 */
async function uploadImages(
  imageMap: OfferImageMap
): Promise<Map<string, string>> {
  const client = getClient();
  const urlMap = new Map<string, string>();

  for (const [key, { data, mimeType }] of imageMap.entries()) {
    const storagePath = `${IMAGES_PREFIX}${key}`;
    const { error } = await client.storage
      .from(BUCKET)
      .upload(storagePath, data, { contentType: mimeType, upsert: true });

    if (!error || error.message?.includes("already exists")) {
      urlMap.set(key, `/api/admin/offer-images/${key}`);
    } else {
      console.warn(`[offerStorage] Image upload failed for ${key}: ${error.message}`);
    }
  }

  return urlMap;
}

/** Replace OFFER_IMG: placeholders with real API-served URLs */
function resolveImagePlaceholders(html: string, urlMap: Map<string, string>): string {
  return html.replace(OFFER_IMG_RE, (_match, key) => {
    return urlMap.get(key) ?? `OFFER_IMG:${key}`;
  });
}

/**
 * Resolve /api/admin/offer-images/ URLs back to base64 data URIs.
 * Called server-side before passing HTML to htmlToDocxElements().
 */
export async function resolveHtmlImages(html: string): Promise<string> {
  const client = getClient();
  const matches = [...html.matchAll(OFFER_IMG_URL_RE)];
  if (matches.length === 0) return html;

  let resolved = html;
  const seen = new Map<string, string>(); // key → data URI

  for (const match of matches) {
    const key = match[1];
    if (seen.has(key)) continue;

    try {
      const storagePath = `${IMAGES_PREFIX}${key}`;
      const { data, error } = await client.storage
        .from(BUCKET)
        .download(storagePath);

      if (error || !data) {
        console.warn(`[offerStorage] Cannot resolve image ${key}: ${error?.message}`);
        continue;
      }

      const ab = await data.arrayBuffer();
      const buf = Buffer.from(ab);
      const ext = key.split(".").pop() ?? "png";
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      const b64 = buf.toString("base64");
      seen.set(key, `data:${mimeType};base64,${b64}`);
    } catch (e) {
      console.warn(`[offerStorage] Image resolve error for ${key}:`, e);
    }
  }

  for (const [key, dataUri] of seen.entries()) {
    resolved = resolved.replaceAll(`/api/admin/offer-images/${key}`, dataUri);
  }

  return resolved;
}

/** Normalize a title for deduplication comparison */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[.,;:!?–—\-()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter out SMR sections whose normalized title already exists in the DB.
 * Prevents duplicate SMR technology templates across multiple offer uploads.
 * Non-SMR sections are always kept.
 */
async function deduplicateSmrSections(
  client: ReturnType<typeof getClient>,
  sections: (ParsedOfferSection & { embedding?: number[] })[]
): Promise<(ParsedOfferSection & { embedding?: number[] })[]> {
  const smrSections = sections.filter((s) => s.section_type === "smr_technology");
  if (smrSections.length === 0) return sections;

  // Fetch all existing SMR titles from DB
  const { data: existing } = await client
    .from("offer_sections")
    .select("title")
    .eq("section_type", "smr_technology");

  const existingNormalized = new Set(
    (existing ?? []).map((e: { title: string }) => normalizeTitle(e.title))
  );

  const deduplicated = sections.filter((s) => {
    if (s.section_type !== "smr_technology") return true;
    const norm = normalizeTitle(s.title);
    if (existingNormalized.has(norm)) {
      console.log(`[offerStorage] Skipping duplicate SMR: "${s.title}"`);
      return false;
    }
    // Also prevent duplicates within the same upload batch
    existingNormalized.add(norm);
    return true;
  });

  const skipped = sections.filter((s) => s.section_type === "smr_technology").length -
    deduplicated.filter((s) => s.section_type === "smr_technology").length;
  if (skipped > 0) {
    console.log(`[offerStorage] Deduplication: skipped ${skipped} SMR sections already in DB`);
  }

  return deduplicated;
}

/** Save offer metadata + extracted sections (with embeddings) to DB */
export async function saveOffer(
  filename: string,
  buffer: Buffer,
  sections: (ParsedOfferSection & { embedding?: number[] })[],
  imageMap: OfferImageMap
): Promise<OfferInfo> {
  const client = getClient();

  const storagePath = await uploadDocxToStorage(filename, buffer);
  const urlMap = await uploadImages(imageMap);

  // Deduplicate SMR sections — skip any that already exist in DB by normalized title
  const uniqueSections = await deduplicateSmrSections(client, sections);

  const resolvedSections = uniqueSections.map((s) => ({
    ...s,
    html_content: resolveImagePlaceholders(s.html_content, urlMap),
  }));

  const { data: offerRow, error: offerErr } = await client
    .from("offer_uploads")
    .insert({
      name: filename,
      filename,
      storage_path: storagePath,
      file_size: buffer.length,
      section_count: resolvedSections.length,
    })
    .select()
    .single();

  if (offerErr) throw new Error(`DB insert offer failed: ${offerErr.message}`);

  const offerId = offerRow.id as string;

  const sectionRows = resolvedSections.map((s, i) => ({
    offer_id: offerId,
    section_type: s.section_type,
    title: s.title,
    html_content: s.html_content,
    plain_text: s.plain_text,
    embedding: s.embedding ?? null,
    order_index: s.order_index ?? i,
  }));

  const { error: sectionsErr } = await client
    .from("offer_sections")
    .insert(sectionRows);

  if (sectionsErr)
    throw new Error(`DB insert sections failed: ${sectionsErr.message}`);

  // Regenerate the SMR template DOCX file (non-blocking — don't fail the upload)
  generateAndUploadSmrTemplateDocx().catch((err) =>
    console.warn("[offerStorage] Template DOCX generation failed:", err)
  );

  return {
    id: offerId,
    name: filename,
    filename,
    storage_path: storagePath,
    file_size: buffer.length,
    section_count: resolvedSections.length,
    created_at: offerRow.created_at as string,
  };
}

/** List all uploaded offers, newest first */
export async function listOffers(): Promise<OfferInfo[]> {
  const client = getClient();
  const { data, error } = await client
    .from("offer_uploads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list offers: ${error.message}`);
  return (data ?? []) as OfferInfo[];
}

/** Get all sections for a specific offer */
export async function getOfferSections(
  offerId: string
): Promise<OfferSectionRecord[]> {
  const client = getClient();
  const { data, error } = await client
    .from("offer_sections")
    .select("id, offer_id, section_type, title, html_content, plain_text, order_index, created_at")
    .eq("offer_id", offerId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(`Failed to fetch sections: ${error.message}`);
  return (data ?? []) as OfferSectionRecord[];
}

/** Delete an offer and all its sections (CASCADE) */
export async function deleteOffer(offerId: string): Promise<void> {
  const client = getClient();

  const { data: offer } = await client
    .from("offer_uploads")
    .select("storage_path")
    .eq("id", offerId)
    .single();

  const { error: dbErr } = await client
    .from("offer_uploads")
    .delete()
    .eq("id", offerId);

  if (dbErr) throw new Error(`Failed to delete offer: ${dbErr.message}`);

  if (offer?.storage_path) {
    await client.storage.from(BUCKET).remove([offer.storage_path]);
  }

  // Regenerate the SMR template DOCX file (templates may have changed)
  generateAndUploadSmrTemplateDocx().catch((err) =>
    console.warn("[offerStorage] Template DOCX generation failed:", err)
  );
}

/**
 * Re-parse an existing offer: download its DOCX from storage, delete old
 * sections, re-parse with current logic, re-embed, and save new sections.
 * The offer_uploads row and stored DOCX/images are preserved.
 */
export async function reparseOffer(
  offerId: string,
  parseFn: (buffer: Buffer) => Promise<{ sections: import("./offerParser").ParsedOfferSection[]; imageMap: import("./offerParser").OfferImageMap }>,
  embedFn: (texts: string[]) => Promise<number[][]>
): Promise<{ sectionCount: number; sectionTypes: { type: string; title: string }[] }> {
  const client = getClient();

  // 1. Fetch offer metadata
  const { data: offer, error: fetchErr } = await client
    .from("offer_uploads")
    .select("id, storage_path, filename")
    .eq("id", offerId)
    .single();

  if (fetchErr || !offer) throw new Error(`Offer not found: ${fetchErr?.message}`);

  // 2. Download original DOCX from storage
  const { data: blob, error: dlErr } = await client.storage
    .from(BUCKET)
    .download(offer.storage_path);
  if (dlErr || !blob) throw new Error(`Failed to download DOCX: ${dlErr?.message}`);
  const buffer = Buffer.from(await blob.arrayBuffer());

  // 3. Re-parse with current (fixed) logic
  const { sections, imageMap } = await parseFn(buffer);

  // 4. Upload any new images (upsert=true avoids duplicates)
  const urlMap = await uploadImages(imageMap);

  // 5. Generate embeddings
  let embeddings: number[][] = [];
  try {
    embeddings = await embedFn(sections.map((s) => s.plain_text));
  } catch {
    embeddings = sections.map(() => []);
  }

  // 6. Delete old sections
  const { error: delErr } = await client
    .from("offer_sections")
    .delete()
    .eq("offer_id", offerId);
  if (delErr) throw new Error(`Failed to delete old sections: ${delErr.message}`);

  // 7. Deduplicate SMR sections against OTHER offers (not this one, since we just deleted its sections)
  const sectionsWithEmbeddings = sections.map((s, i) => ({
    ...s,
    embedding: embeddings[i]?.length > 0 ? embeddings[i] : undefined,
  }));
  const uniqueSections = await deduplicateSmrSections(client, sectionsWithEmbeddings);

  // 8. Resolve image placeholders and insert new sections
  const resolvedSections = uniqueSections.map((s) => ({
    ...s,
    html_content: resolveImagePlaceholders(s.html_content, urlMap),
  }));

  const sectionRows = resolvedSections.map((s, i) => ({
    offer_id: offerId,
    section_type: s.section_type,
    title: s.title,
    html_content: s.html_content,
    plain_text: s.plain_text,
    embedding: s.embedding ?? null,
    order_index: s.order_index ?? i,
  }));

  const { error: insertErr } = await client
    .from("offer_sections")
    .insert(sectionRows);
  if (insertErr) throw new Error(`Failed to insert new sections: ${insertErr.message}`);

  // 9. Update section count on the offer row
  await client
    .from("offer_uploads")
    .update({ section_count: resolvedSections.length })
    .eq("id", offerId);

  // Regenerate the SMR template DOCX file
  generateAndUploadSmrTemplateDocx().catch((err) =>
    console.warn("[offerStorage] Template DOCX generation failed:", err)
  );

  return {
    sectionCount: resolvedSections.length,
    sectionTypes: resolvedSections.map((s) => ({ type: s.section_type, title: s.title })),
  };
}

/**
 * Load all unique smr_technology sections from the DB as SmrTemplate-compatible
 * objects. This replaces the old manually-uploaded "Шаблони СМР.docx" approach —
 * the templates now grow automatically as offers are uploaded.
 */
export async function loadSmrTemplatesFromOffers(): Promise<
  { title: string; body: string; htmlBody: string }[]
> {
  const client = getClient();

  const { data, error } = await client
    .from("offer_sections")
    .select("title, plain_text, html_content")
    .eq("section_type", "smr_technology")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load SMR templates: ${error.message}`);
  if (!data || data.length === 0) return [];

  // Deduplicate by normalized title — keep the version with the LONGEST plain_text.
  // Different offers may describe the same technology with varying detail; the richest
  // version (with full "Технология за изпълнение" description) produces better output.
  const bestByTitle = new Map<string, { title: string; body: string; htmlBody: string }>();

  for (const row of data) {
    const norm = normalizeTitle(row.title);
    const existing = bestByTitle.get(norm);
    if (!existing || (row.plain_text?.length ?? 0) > (existing.body?.length ?? 0)) {
      bestByTitle.set(norm, {
        title: row.title,
        body: row.plain_text,
        htmlBody: row.html_content,
      });
    }
  }

  const templates = [...bestByTitle.values()];

  return templates;
}

const TEMPLATES_BUCKET = "smr-templates";
const GENERATED_TEMPLATE_PATH = "auto_generated_smr_templates.docx";

/**
 * Generate a DOCX file containing all SMR templates from the DB and upload
 * it to Supabase Storage for viewing/download. The file is overwritten each time.
 */
export async function generateAndUploadSmrTemplateDocx(): Promise<void> {
  const templates = await loadSmrTemplatesFromOffers();
  if (templates.length === 0) return;

  const FONT = "Times New Roman";
  const FONT_SIZE = 22; // 11pt in half-points

  const children: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: "СМР Шаблони (автоматично генериран)",
          bold: true,
          font: FONT,
          size: 28,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 300 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Общо шаблони: ${templates.length} | Генериран: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          font: FONT,
          size: 20,
          italics: true,
        }),
      ],
      spacing: { after: 400 },
    }),
  ];

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];

    // Section separator
    if (i > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "─".repeat(60), font: FONT, size: FONT_SIZE })],
          spacing: { before: 300, after: 300 },
        })
      );
    }

    // Title
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${i + 1}. ${t.title}`,
            bold: true,
            font: FONT,
            size: 24,
          }),
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      })
    );

    // Body text (plain text, split into paragraphs)
    const lines = t.body.split(/\n+/).filter((l) => l.trim());
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line.trim(), font: FONT, size: FONT_SIZE })],
          spacing: {
            line: 240,
            lineRule: LineRuleType.AT_LEAST,
            before: 60,
            after: 60,
          },
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);

  const client = getClient();
  // Remove old file first (upsert doesn't work for storage replace)
  await client.storage.from(TEMPLATES_BUCKET).remove([GENERATED_TEMPLATE_PATH]);
  const { error } = await client.storage
    .from(TEMPLATES_BUCKET)
    .upload(GENERATED_TEMPLATE_PATH, Buffer.from(buffer), {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (error) {
    console.warn(`[offerStorage] Failed to upload generated template: ${error.message}`);
  } else {
    console.log(
      `[offerStorage] Generated SMR template DOCX uploaded (${templates.length} templates)`
    );
  }
}

/** Download original DOCX for a specific offer */
export async function downloadOffer(storagePath: string): Promise<Buffer> {
  const client = getClient();
  const { data, error } = await client.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) throw new Error(`Failed to download offer: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Download a stored offer image by its key (e.g. "abc123.jpg") */
export async function downloadOfferImage(
  key: string
): Promise<{ data: Buffer; mimeType: string }> {
  const client = getClient();
  const storagePath = `${IMAGES_PREFIX}${key}`;
  const { data, error } = await client.storage.from(BUCKET).download(storagePath);

  if (error || !data)
    throw new Error(`Image not found: ${key} — ${error?.message}`);

  const ab = await data.arrayBuffer();
  const ext = key.split(".").pop() ?? "png";
  const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return { data: Buffer.from(ab), mimeType };
}
