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
        { error: 'No files uploaded' },
        { status: 400 }
      );
    }

    const results: { filename: string; text: string }[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;

      if (!isAllowedFile(file.type, file.name)) {
        return NextResponse.json(
          { error: 'Only PDF, DOC and DOCX files are allowed' },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `File ${file.name} exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit` },
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
    const message = err instanceof Error ? err.message : 'Failed to parse files';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
