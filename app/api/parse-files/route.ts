/**
 * File upload and parse API route
 * Next.js: uses request.formData(), formData.getAll('files'), File → Buffer via arrayBuffer()
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  extractTextFromBuffer,
  MAX_FILE_SIZE_BYTES,
  isAllowedFile,
} from '@/lib/fileParser';
import { fixFilenameEncoding } from '@/lib/filenameEncoding';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files?.length) {
      return NextResponse.json(
        { error: 'Не са качени файлове' },
        { status: 400 }
      );
    }

    const results: { filename: string; text: string }[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;

      if (!isAllowedFile(file.type, file.name)) {
        return NextResponse.json(
          { error: 'Разрешени са само PDF, DOC и DOCX файлове' },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `Файлът ${file.name} надвишава лимита от ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB` },
          { status: 400 }
        );
      }

      const filename = fixFilenameEncoding(file.name);
      const text = await extractTextFromBuffer(buffer, file.type, filename);
      results.push({ filename, text });
    }

    const mergedText = results.map((r) => `--- ${r.filename} ---\n${r.text}`).join('\n\n');

    return NextResponse.json({ text: mergedText, files: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Грешка при обработката на файловете';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
