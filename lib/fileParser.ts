/**
 * File parser for PDF, DOC and DOCX extraction
 * Uses pdf-parse for PDF, mammoth for DOCX and textutil (macOS) for DOC.
 * Legacy .doc is only supported on macOS; on Linux (Vercel) an error is thrown.
 * For scanned PDFs (no or bad text layer), falls back to OCR with Tesseract (Bulgarian + English).
 */

import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text?: string }>;
import mammoth from 'mammoth';
const execFileAsync = promisify(execFile);

/** Max PDF pages to run OCR on (keeps processing under ~1 min) */
const OCR_MAX_PAGES = 30;

/** Returns true if extracted text looks like bad OCR (e.g. Latin instead of Cyrillic for Bulgarian docs) */
function isLikelyGarbagePdfText(text: string): boolean {
  if (!text || text.length < 80) return true;
  const letters = text.replace(/[\s\d\p{P}]/gu, '');
  if (letters.length < 50) return true;
  const cyrillic = (letters.match(/[\u0400-\u04FF]/g) ?? []).length;
  const latin = (letters.match(/[a-zA-Z]/g) ?? []).length;
  const total = cyrillic + latin;
  if (total < 30) return true;
  // If most letters are Latin and few Cyrillic, likely wrong OCR for a Bulgarian document
  const cyrillicRatio = cyrillic / total;
  return cyrillicRatio < 0.15 && latin > 20;
}

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB per file (no 10MB cap)

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

/** Run OCR on PDF pages (Bulgarian + English) and return combined text. Used for scanned PDFs. */
async function extractPdfTextViaOcr(buffer: Buffer): Promise<string> {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(buffer, { scale: 2 });
  const worker = await createWorker('bul+eng', 1, {
    logger: () => {},
  });
  const parts: string[] = [];
  let pageCount = 0;
  try {
    for await (const pageImage of doc) {
      if (pageCount >= OCR_MAX_PAGES) break;
      const {
        data: { text },
      } = await worker.recognize(pageImage);
      if (text?.trim()) parts.push(text.trim());
      pageCount += 1;
    }
  } finally {
    await worker.terminate();
  }
  return parts.join('\n\n').trim();
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  const text = data.text?.trim() ?? '';
  if (!isLikelyGarbagePdfText(text)) return text;
  try {
    const ocrText = await extractPdfTextViaOcr(buffer);
    if (ocrText && ocrText.length > text.length) return ocrText;
  } catch {
    // OCR failed (e.g. Tesseract data not loaded); keep original
  }
  return text;
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value?.trim() ?? '';
}

export async function extractDocText(buffer: Buffer): Promise<string> {
  // macOS textutil can convert legacy .doc reliably without extra npm deps.
  if (process.platform !== 'darwin') {
    throw new Error(
      'Файлове .doc не се поддържат на този сървър. Моля, конвертирайте файла в .docx или .pdf и опитайте отново.'
    );
  }

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
  } catch (err) {
    throw new Error(
      `Грешка при четене на .doc файл: ${err instanceof Error ? err.message : String(err)}`
    );
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
