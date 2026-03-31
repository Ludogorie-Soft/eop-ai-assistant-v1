/**
 * GET /api/admin/offers/[id]/download
 * Downloads the original DOCX file for a specific offer.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const key = (rawKey ?? "").trim().replace(/^["']|["']$/g, "");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  return createClient(url, key);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const client = getSupabase();
    const { data: offer, error: fetchError } = await client
      .from("offer_uploads")
      .select("storage_path, filename")
      .eq("id", id)
      .single();

    if (fetchError || !offer) {
      return NextResponse.json({ error: "Offer not found." }, { status: 404 });
    }

    const { data: fileData, error: downloadError } = await client.storage
      .from("offer-uploads")
      .download(offer.storage_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(offer.filename)}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
