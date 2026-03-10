/**
 * Download an SMR template from Supabase Storage.
 * GET ?path=<storage-path>
 */

import { NextRequest, NextResponse } from 'next/server';
import { downloadTemplate } from '@/lib/templateStorage';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    if (!path) {
      return NextResponse.json(
        { error: 'Параметър "path" е задължителен.' },
        { status: 400 }
      );
    }

    const buffer = await downloadTemplate(path);

    const filename = path.replace(/^\d{4}-\d{2}-\d{2}_/, '');

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to download template';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
