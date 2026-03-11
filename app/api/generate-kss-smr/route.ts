/**
 * KSS → SMR generation API.
 * POST multipart: kssFile (Excel) only.
 * SMR templates are loaded from the DB (offer_sections with type smr_technology),
 * built automatically from uploaded offers.
 * Returns { results: SmrResult[] }.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseKssExcel, type KssItem } from "@/lib/kssParser";
import { generateSmrTextsForKss } from "@/lib/kssSmrGenerator";
import { loadSmrTemplatesFromOffers } from "@/lib/offerStorage";

const EXCEL_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const MAX_KSS_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function isExcelFile(file: File): boolean {
  return EXCEL_TYPES.includes(file.type) || /\.(xlsx|xls)$/i.test(file.name);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const kssFiles = formData
      .getAll("kssFile")
      .filter((f): f is File => f instanceof File);

    if (kssFiles.length === 0) {
      return NextResponse.json(
        { error: "Изберете поне един KSS Excel файл." },
        { status: 400 },
      );
    }

    for (const file of kssFiles) {
      if (!isExcelFile(file)) {
        return NextResponse.json(
          { error: `Файлът "${file.name}" не е Excel (.xlsx или .xls).` },
          { status: 400 },
        );
      }
    }

    const allKssItems: KssItem[] = [];
    let columnFallbackUsed = false;
    for (const file of kssFiles) {
      if (file.size > MAX_KSS_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `Файлът "${file.name}" надвишава лимита от ${MAX_KSS_FILE_SIZE_BYTES / 1024 / 1024}MB.` },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const { items, headersMatched } = parseKssExcel(buf);
      allKssItems.push(...items);
      if (!headersMatched) columnFallbackUsed = true;
    }

    if (allKssItems.length === 0) {
      return NextResponse.json(
        { error: "В избраните Excel файлове няма намерени KSS позиции." },
        { status: 400 },
      );
    }

    // Load SMR templates from the DB (built from uploaded offers)
    const smrTemplates = await loadSmrTemplatesFromOffers();

    if (smrTemplates.length === 0) {
      return NextResponse.json(
        {
          error:
            'Няма налични СМР шаблони. Качете поне една оферта в секция „Оферти", за да се генерират автоматично.',
        },
        { status: 400 },
      );
    }

    console.log(
      `[generate-kss-smr] Using ${smrTemplates.length} SMR templates from offer DB`
    );

    const results = await generateSmrTextsForKss(allKssItems, smrTemplates);

    const response: { results: typeof results; warning?: string } = { results };
    if (columnFallbackUsed) {
      response.warning =
        "Забележка: Колоните код, наименование, м.е. и количество не са намерени по заглавия. Използвани са първите 4 колони – проверете дали данните са коректни.";
    }
    return NextResponse.json(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate KSS SMR texts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
