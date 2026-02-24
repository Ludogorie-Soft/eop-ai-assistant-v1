/**
 * KSS → SMR generation API.
 * POST multipart: kssFile (Excel) only. SMR template is read from project root: "Шаблони СМР.docx".
 * Returns { results: SmrResult[] }.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { parseKssExcel } from '@/lib/kssParser';
import { parseSmrTemplateDocx } from '@/lib/smrTemplateParser';
import { generateSmrTextsForKss } from '@/lib/kssSmrGenerator';

const SMR_TEMPLATE_FILENAME = 'Шаблони СМР.docx';

const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

function isExcelFile(file: File): boolean {
  return (
    EXCEL_TYPES.includes(file.type) || /\.(xlsx|xls)$/i.test(file.name)
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const kssFiles = formData.getAll('kssFile').filter((f): f is File => f instanceof File);

    if (kssFiles.length === 0) {
      return NextResponse.json(
        { error: 'Изберете поне един KSS Excel файл.' },
        { status: 400 }
      );
    }

    for (const file of kssFiles) {
      if (!isExcelFile(file)) {
        return NextResponse.json(
          { error: `Файлът "${file.name}" не е Excel (.xlsx или .xls).` },
          { status: 400 }
        );
      }
    }

    const allKssItems: ReturnType<typeof parseKssExcel> = [];
    for (const file of kssFiles) {
      const buf = Buffer.from(await file.arrayBuffer());
      const items = parseKssExcel(buf);
      allKssItems.push(...items);
    }

    if (allKssItems.length === 0) {
      return NextResponse.json(
        { error: 'В избраните Excel файлове няма намерени KSS позиции.' },
        { status: 400 }
      );
    }

    const kssItems = allKssItems;

    const templatePath = join(process.cwd(), SMR_TEMPLATE_FILENAME);
    let docxBuf: Buffer;
    try {
      docxBuf = await readFile(templatePath);
    } catch {
      return NextResponse.json(
        { error: `Шаблонът "${SMR_TEMPLATE_FILENAME}" не е намерен в корена на проекта. Добавете файла там.` },
        { status: 400 }
      );
    }

    const smrTemplates = await parseSmrTemplateDocx(docxBuf);
    if (smrTemplates.length === 0) {
      return NextResponse.json(
        { error: 'No SMR blocks found in the template DOCX. Ensure the file has headings (Heading 1/2, etc.).' },
        { status: 400 }
      );
    }

    const results = await generateSmrTextsForKss(kssItems, smrTemplates);

    return NextResponse.json({ results });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate KSS SMR texts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
