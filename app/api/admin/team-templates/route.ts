/**
 * Admin API for managing team position templates in Supabase Storage.
 * GET  — list all team templates
 * POST — upload a new team template (.docx)
 * DELETE — remove a team template by path (query param ?path=...)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listTeamTemplates,
  uploadTeamTemplate,
  deleteTeamTemplate,
} from '@/lib/teamTemplateStorage';
import { parseTeamTemplateDocx } from '@/lib/teamTemplateParser';

export async function GET() {
  try {
    const templates = await listTeamTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to list team templates';
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
      const positions = await parseTeamTemplateDocx(buffer);
      positionCount = positions.length;
    } catch {
      return NextResponse.json(
        { error: 'Файлът не може да бъде парснат като шаблон за длъжности. Проверете формата.' },
        { status: 400 }
      );
    }

    if (positionCount === 0) {
      return NextResponse.json(
        { error: 'Не са намерени длъжности във файла. Проверете дали файлът е правилен шаблон.' },
        { status: 400 }
      );
    }

    const info = await uploadTeamTemplate(file.name, buffer);

    return NextResponse.json({ template: info, positionCount });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to upload team template';
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

    await deleteTeamTemplate(path);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete team template';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

