/**
 * Admin API for managing SMR templates in Supabase Storage.
 * GET  - list all templates
 * POST - upload a new template (.docx)
 * DELETE - remove a template by path (query param ?path=...)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listTemplates,
  uploadTemplate,
  deleteTemplate,
} from '@/lib/templateStorage';
import { parseSmrTemplateDocx } from '@/lib/smrTemplateParser';

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to list templates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Изберете .docx файл за качване.' },
        { status: 400 }
      );
    }

    if (file.type !== DOCX_MIME && !file.name.endsWith('.docx')) {
      return NextResponse.json(
        { error: 'Само .docx файлове са разрешени.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let positionCount = 0;
    try {
      const positions = await parseSmrTemplateDocx(buffer);
      positionCount = positions.length;
    } catch {
      return NextResponse.json(
        { error: 'Файлът не може да бъде парснат като СМР шаблон. Проверете формата.' },
        { status: 400 }
      );
    }

    if (positionCount === 0) {
      return NextResponse.json(
        { error: 'Не са намерени СМР позиции във файла. Проверете дали файлът е правилен шаблон.' },
        { status: 400 }
      );
    }

    const info = await uploadTemplate(file.name, buffer);

    return NextResponse.json({ template: info, positionCount });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to upload template';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    if (!path) {
      return NextResponse.json(
        { error: 'Параметър "path" е задължителен.' },
        { status: 400 }
      );
    }

    if (path.includes('..') || path.startsWith('/')) {
      return NextResponse.json(
        { error: 'Невалиден път.' },
        { status: 400 }
      );
    }

    await deleteTemplate(path);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete template';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
