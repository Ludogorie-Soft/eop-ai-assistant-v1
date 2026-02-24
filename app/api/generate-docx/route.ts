/**
 * DOCX generation and download API route
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateTenderDocx } from '@/lib/docxGenerator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { introductionText, rawText } = body as {
      introductionText?: string;
      rawText?: string;
    };
    if (!introductionText || typeof introductionText !== 'string') {
      return NextResponse.json(
        { error: 'Introduction text is required' },
        { status: 400 }
      );
    }

    const { buffer, filename } = await generateTenderDocx(
      introductionText,
      typeof rawText === 'string' ? rawText : undefined
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
