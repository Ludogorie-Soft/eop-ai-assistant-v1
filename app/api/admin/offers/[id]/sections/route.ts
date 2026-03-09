/**
 * GET /api/admin/offers/[id]/sections
 * Returns all extracted sections for a specific offer (with html_content for preview).
 */

import { NextRequest, NextResponse } from "next/server";
import { getOfferSections } from "@/lib/offerStorage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id е задължителен." }, { status: 400 });
    }

    const sections = await getOfferSections(id);
    return NextResponse.json({ sections });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load sections";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
