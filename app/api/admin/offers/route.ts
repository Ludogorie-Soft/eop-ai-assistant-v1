/**
 * Admin API for managing complete offer uploads (Пълни Оферти).
 * GET    - list all uploaded offers
 * POST   - upload a complete offer DOCX, extract sections, embed, save
 * DELETE - remove an offer and all its sections (?id=...)
 */

import { NextRequest, NextResponse } from "next/server";
import { parseOfferDocx } from "@/lib/offerParser";
import { embedTexts } from "@/lib/offerEmbeddings";
import { listOffers, saveOffer, deleteOffer, reparseOffer } from "@/lib/offerStorage";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET() {
  try {
    const offers = await listOffers();
    return NextResponse.json({ offers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list offers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Изберете .docx файл за качване." },
        { status: 400 }
      );
    }

    if (file.type !== DOCX_MIME && !file.name.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Само .docx файлове са разрешени." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Step 1: Parse DOCX → extract sections with AI + image map
    let sections;
    let imageMap;
    try {
      const result = await parseOfferDocx(buffer);
      sections = result.sections;
      imageMap = result.imageMap;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parse error";
      return NextResponse.json(
        { error: `Грешка при парсване: ${msg}` },
        { status: 400 }
      );
    }

    if (sections.length === 0) {
      return NextResponse.json(
        { error: "Не са намерени секции в документа." },
        { status: 400 }
      );
    }

    // Step 2: Generate embeddings for all sections
    let embeddings: number[][] = [];
    try {
      embeddings = await embedTexts(sections.map((s) => s.plain_text));
    } catch (err) {
      console.warn("[offers API] Embedding failed, saving without embeddings:", err);
      embeddings = sections.map(() => []);
    }

    // Step 3: Attach embeddings to sections
    const sectionsWithEmbeddings = sections.map((s, i) => ({
      ...s,
      embedding: embeddings[i]?.length > 0 ? embeddings[i] : undefined,
    }));

    // Step 4: Save to Supabase (uploads images + resolves placeholders)
    const offerInfo = await saveOffer(file.name, buffer, sectionsWithEmbeddings, imageMap);

    return NextResponse.json({
      offer: offerInfo,
      sectionCount: sections.length,
      sectionTypes: sections.map((s) => ({ type: s.section_type, title: s.title })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH - Re-parse an existing offer with updated parsing logic.
 * Body: { id: string } or { all: true } to reparse everything.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.all) {
      // Reparse ALL offers
      const offers = await listOffers();
      const results = [];
      for (const offer of offers) {
        try {
          const result = await reparseOffer(offer.id, parseOfferDocx, embedTexts);
          results.push({ id: offer.id, name: offer.filename, ...result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Reparse failed";
          results.push({ id: offer.id, name: offer.filename, error: msg });
        }
      }
      return NextResponse.json({ results });
    }

    const id = body.id;
    if (!id) {
      return NextResponse.json(
        { error: 'Параметър "id" е задължителен.' },
        { status: 400 }
      );
    }

    const result = await reparseOffer(id, parseOfferDocx, embedTexts);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reparse failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: 'Параметър "id" е задължителен.' },
        { status: 400 }
      );
    }

    await deleteOffer(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
