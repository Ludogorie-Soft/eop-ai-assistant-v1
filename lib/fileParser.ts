/**
 * File parser for PDF, DOC and DOCX extraction
 * Uses pdf-parse for PDF, mammoth for DOCX and textutil (macOS) for DOC
 */

import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text?: string }>;
import mammoth from 'mammoth';
const execFileAsync = promisify(execFile);

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per file

export function isAllowedFile(mimetype: string, filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  if (mimetype === 'application/pdf' || ext === 'pdf') return true;
  if (mimetype === 'application/msword' || ext === 'doc') return true;
  if (
    mimetype ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  )
    return true;
  return false;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text?.trim() ?? '';
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value?.trim() ?? '';
}

export async function extractDocText(buffer: Buffer): Promise<string> {
  // macOS textutil can convert legacy .doc reliably without extra npm deps.
  if (process.platform !== 'darwin') return '';

  const dir = await mkdtemp(join(tmpdir(), 'eop-doc-'));
  const inputPath = join(dir, 'input.doc');

  try {
    await writeFile(inputPath, buffer);
    const { stdout } = await execFileAsync('/usr/bin/textutil', [
      '-convert',
      'txt',
      '-stdout',
      inputPath,
    ]);
    return stdout.trim();
  } catch {
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimetype: string,
  filename: string
): Promise<string> {
  if (!isAllowedFile(mimetype, filename)) {
    throw new Error('Only PDF, DOC and DOCX files are allowed');
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
  }

  const ext = filename.toLowerCase().split('.').pop();
  if (mimetype === 'application/pdf' || ext === 'pdf') {
    return extractPdfText(buffer);
  }
  if (mimetype === 'application/msword' || ext === 'doc') {
    return extractDocText(buffer);
  }
  return extractDocxText(buffer);
}

/** Extract text from buffer by URL - infers type from extension (PDF, DOC, DOCX) */
export async function extractTextFromBufferByUrl(
  buffer: Buffer,
  url: string
): Promise<string> {
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop() ?? 'document';
  const ext = filename.toLowerCase().split('.').pop();
  const mimetype =
    ext === 'pdf'
      ? 'application/pdf'
      : ext === 'doc'
        ? 'application/msword'
      : ext === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/octet-stream';
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx') {
    try {
      return await extractTextFromBuffer(buffer, mimetype, filename);
    } catch {
      return '';
    }
  }
  return '';
}
