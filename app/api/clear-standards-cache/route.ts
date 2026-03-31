import { NextResponse } from "next/server";
import { clearCache } from "@/lib/standardsCache";

export async function POST() {
  await clearCache();
  return NextResponse.json({ ok: true, message: "Кешът е изчистен." });
}
