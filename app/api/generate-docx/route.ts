/**
 * DOCX generation and download API route
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateTenderDocx, type SmrResultForDocx } from '@/lib/docxGenerator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { introductionText, rawText, smrResults } = body as {
      introductionText?: string;
      rawText?: string;
      smrResults?: SmrResultForDocx[];
    };
    const hasIntroduction = typeof introductionText === 'string' && introductionText.trim().length > 0;
    const hasSmr = Array.isArray(smrResults) && smrResults.length > 0;
    if (!hasIntroduction && !hasSmr) {
      return NextResponse.json(
        { error: 'Нужен е поне увод или генерирани текстове за КСС за експорт.' },
        { status: 400 }
      );
    }

    const smr: SmrResultForDocx[] | undefined = Array.isArray(smrResults)
      ? smrResults
      : undefined;

    const { buffer, filename } = await generateTenderDocx(
      hasIntroduction ? introductionText : undefined,
      typeof rawText === 'string' ? rawText : undefined,
      smr
    );

    const asciiFallback = 'tender.docx';
    const encodedFilename = encodeURIComponent(filename);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate DOCX';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
