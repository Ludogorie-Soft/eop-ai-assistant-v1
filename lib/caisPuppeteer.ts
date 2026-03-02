/**
 * CAIS fetcher using Puppeteer - renders SPA and extracts document links
 * Downloads PDF/DOC/DOCX, uploads to Supabase Storage
 * Returns merged text from storage
 */

import { existsSync } from 'node:fs';
import puppeteer, { Browser } from 'puppeteer';
import {
  getTenderKeyFromUrl,
  uploadToStorage,
  listTenderFiles,
  downloadFromStorage,
} from './supabaseStorage';
import { extractTextFromBufferByUrl } from './fileParser';

const CAIS_ALLOWED_HOSTS = [
  'www.cais.bg',
  'cais.bg',
  'opendata.cais.bg',
  'eop.bg',
  'www.eop.bg',
  'app.eop.bg',
];

const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024; // 100MB
const PAGE_WAIT_MS = 8000;

const PAGE_ERROR_PATTERNS = [
  /__name.*(?:is not defined|not defined)/i,
  /NameError|ReferenceError|SyntaxError/i,
  /traceback|exception/i,
];

function isLikelyPageError(text: string): boolean {
  return PAGE_ERROR_PATTERNS.some((p) => p.test(text));
}

function extractDocLinksFromHtml(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const urlRegex = /https?:\/\/[^\s"'<>]+\.(pdf|docx|doc)(?:\?[^\s"'<>]*)?/gi;
  let m;

  while ((m = hrefRegex.exec(html)) !== null) {
    const href = m[1].trim();
    const isDoc =
      /\.(pdf|docx|doc)(?:\?|$)/i.test(href) ||
      /\/blob\/|\/document\/|\/attachment\/|\/file\//.test(href);
    if (isDoc) {
      try {
        const absolute = new URL(href, base);
        if (absolute.protocol === 'https:') links.add(absolute.href);
      } catch {
        /* skip */
      }
    }
  }

  const blobRegex = /https?:\/\/[^\s"'<>]+\/api\/blob\/[^\s"'<>]+/gi;
  while ((m = blobRegex.exec(html)) !== null) {
    try {
      const absolute = new URL(m[0]);
      if (absolute.protocol === 'https:') links.add(absolute.href);
    } catch {
      /* skip */
    }
  }

  const relBlobRegex = /["'](\/api\/blob\/[^"'\s]+)["']/g;
  while ((m = relBlobRegex.exec(html)) !== null) {
    try {
      const absolute = new URL(m[1], base);
      if (absolute.protocol === 'https:') links.add(absolute.href);
    } catch {
      /* skip */
    }
  }

  while ((m = urlRegex.exec(html)) !== null) {
    try {
      const absolute = new URL(m[0]);
      if (absolute.protocol === 'https:') links.add(absolute.href);
    } catch {
      /* skip */
    }
  }

  return [...links];
}

function isValidCaisUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    const isHttps = url.protocol === 'https:';
    const isAllowedHost = CAIS_ALLOWED_HOSTS.some(
      (h) => host === h || host.endsWith('.' + h)
    );
    return isHttps && isAllowedHost;
  } catch {
    return false;
  }
}

function isAllowedAttachmentHost(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    return CAIS_ALLOWED_HOSTS.some(
      (h) => host === h || host.endsWith('.' + h)
    );
  } catch {
    return false;
  }
}

type Page = Awaited<ReturnType<Browser['newPage']>>;

/** Extract document links from rendered page using Puppeteer. Returns page for reuse (with session cookies). */
async function extractLinksWithPuppeteer(
  pageUrl: string,
  browser: Browser
): Promise<{ docUrls: string[]; pageText: string; page: Page }> {
  const page = await browser.newPage();

  await page.setUserAgent(
    'EOP-AI-Assistant/1.0 (Tender Technical Generator; +https://eop.bg)'
  );

  await page.goto(pageUrl, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await new Promise((r) => setTimeout(r, PAGE_WAIT_MS));

  // Wait for SPA to render tender content (app.eop.bg loads data via API)
  const contentIndicators = [
    'Обща информация',
    'Прикачени файлове',
    'Възложител',
    'Основни параметри',
    'Обект на поръчката',
  ];
  try {
    await page.waitForFunction(
      (indicators: string[]) => {
        const text = document.body?.innerText ?? '';
        return indicators.some((s) => text.includes(s));
      },
      { timeout: 15000 },
      contentIndicators
    );
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    /* proceed with whatever is rendered */
  }

  let docUrls: string[] = [];
  let pageText = '';

  try {
    const result = await page.evaluate((base: string) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      const docExt = /\.(pdf|docx|doc)(?:\?|$)/i;

        const addUrl = (href: string) => {
          try {
            const absolute = new URL(href, base);
            const isDoc =
              docExt.test(absolute.pathname) ||
              /\/blob\/|\/document\/|\/attachment\/|\/file\//.test(absolute.pathname);
            if (absolute.protocol === 'https:' && isDoc) {
              const key = absolute.href.split('?')[0];
              if (!seen.has(key)) {
                seen.add(key);
                urls.push(absolute.href);
              }
            }
          } catch {
            /* skip */
          }
        };

      const links = document.querySelectorAll('a[href]');
      for (let i = 0; i < links.length; i++) {
        const a = links[i] as HTMLAnchorElement;
        const href = a.href;
        if (!href) continue;
        const isDoc = docExt.test(href) || href.includes('/blob/') || href.includes('/document/') || href.includes('/attachment/') || href.includes('/file/');
        if (isDoc) addUrl(href);
        const text = (a.textContent || '').trim();
        if (text && /\.(pdf|docx|doc)$/i.test(text)) addUrl(href);
      }

      const html = document.documentElement?.innerHTML ?? '';
      const urlRegex = /https?:\/\/[^\s"'<>]+\.(pdf|docx|doc)(?:\?[^\s"'<>]*)?/gi;
      let m;
      while ((m = urlRegex.exec(html)) !== null) {
        addUrl(m[0]);
      }
      const blobRegex = /https?:\/\/[^\s"'<>]+\/api\/blob\/[^\s"'<>]+/gi;
      while ((m = blobRegex.exec(html)) !== null) {
        addUrl(m[0]);
      }
      const relBlobRegex = /["'](\/api\/blob\/[^"'\s]+)["']/g;
      while ((m = relBlobRegex.exec(html)) !== null) {
        addUrl(new URL(m[1], base).href);
      }

      const body = document.body;
      const main =
        document.querySelector('main') ??
        document.querySelector('[role="main"]') ??
        document.querySelector('.content, .main-content, [class*="tender"], [class*="detail"]');
      const el = main && main.innerText?.length > 200 ? main : body;
      const text = el ? el.innerText : body ? body.innerText : '';

      return { docUrls: urls, pageText: (text || '').trim() };
    }, pageUrl);

    docUrls = result.docUrls;
    pageText = result.pageText;
  } catch {
    const html = await page.content();
    docUrls = extractDocLinksFromHtml(html, pageUrl);
  }

  return { docUrls, pageText, page };
}

/** Download file via Puppeteer page - uses browser session/cookies (fixes 403 on app.eop.bg blob API) */
async function downloadFileViaPage(
  page: Page,
  url: string
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  if (!isAllowedAttachmentHost(url)) return null;

  try {
    const result = await page.evaluate(async (docUrl: string) => {
      const res = await fetch(docUrl, { credentials: 'include' });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const arr = Array.from(new Uint8Array(ab));
      const disposition = res.headers.get('content-disposition');
      const contentType = res.headers.get('content-type') ?? '';
      let filename = new URL(docUrl).pathname.split('/').pop() ?? 'document';
      if (disposition) {
        const m =
          disposition.match(/filename\*?=(?:UTF-8'')([^;]+)/i) ??
          disposition.match(/filename=["']?([^"';]+)["']?/i);
        if (m?.[1]) filename = decodeURIComponent(m[1].trim());
      }
      return { data: arr, filename, contentType };
    }, url);

    if (!result?.data) return null;

    const buffer = Buffer.from(result.data);
    if (buffer.length > MAX_ATTACHMENT_SIZE) return null;

    return {
      buffer,
      filename: result.filename,
      contentType: result.contentType ?? '',
    };
  } catch {
    return null;
  }
}

/** Main flow: Puppeteer → extract links → download → Supabase → extract text */
export async function fetchCaisWithPuppeteerAndStorage(url: string): Promise<string> {
  if (!isValidCaisUrl(url)) {
    throw new Error(
      'Invalid CAIS URL. Only https URLs from cais.bg, eop.bg or app.eop.bg are allowed.'
    );
  }

  const tenderKey = getTenderKeyFromUrl(url);
  const parts: string[] = [];

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    (process.platform === 'darwin' &&
      existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const { docUrls, pageText, page } = await extractLinksWithPuppeteer(url, browser);

    if (pageText && !isLikelyPageError(pageText)) {
      parts.push(`--- CAIS: ${url} ---\n\n${pageText}`);
    } else if (pageText && isLikelyPageError(pageText)) {
      parts.push(`--- CAIS: ${url} ---\n\n[Страницата съдържа грешка при зареждане. Извлечени са само документите по-долу.]`);
    }

    const seen = new Set<string>();

    for (const docUrl of docUrls) {
      const normalized = docUrl.split('?')[0];
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const file = await downloadFileViaPage(page, docUrl);
      if (!file) continue;

      let filename = file.filename;
      const pathname = new URL(docUrl).pathname;
      const fileContentType = file.contentType.toLowerCase();
      const lowerName = filename.toLowerCase();
      const hasKnownExt =
        lowerName.endsWith('.pdf') || lowerName.endsWith('.docx') || lowerName.endsWith('.doc');
      if (pathname.includes('/blob/') && (!filename || filename === 'document' || !hasKnownExt)) {
        if (fileContentType.includes('application/pdf')) {
          filename = `document_${seen.size}.pdf`;
        } else if (
          fileContentType.includes(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          )
        ) {
          filename = `document_${seen.size}.docx`;
        } else if (fileContentType.includes('application/msword')) {
          filename = `document_${seen.size}.doc`;
        }
      }

      const ext = filename.toLowerCase().split('.').pop();
      if (ext !== 'pdf' && ext !== 'docx' && ext !== 'doc') continue;

      const contentType =
        ext === 'pdf'
          ? 'application/pdf'
          : ext === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/msword';

      try {
        await uploadToStorage(tenderKey, filename, file.buffer, contentType);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Upload failed for ${filename}:`, err);
        parts.push(`--- Грешка при качване на ${filename} ---\n\n${msg}`);
      }
    }
  } finally {
    await browser.close();
  }

  const storedFiles = await listTenderFiles(tenderKey);
  const extractErrors: string[] = [];

  for (const { name, path } of storedFiles) {
    try {
      const buffer = await downloadFromStorage(path);
      const docUrl = `https://placeholder/${name}`;
      const text = await extractTextFromBufferByUrl(buffer, docUrl);
      if (text.trim()) {
        parts.push(`--- ${name} ---\n\n${text}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Extract failed for ${name}:`, err);
      extractErrors.push(`${name}: ${msg}`);
    }
  }

  if (extractErrors.length > 0) {
    parts.push(`--- Грешки при извличане на текст ---\n\n${extractErrors.join('\n')}`);
  }

  if (parts.length === 0) {
    throw new Error('Не беше извлечен текст от страницата или прикачените документи. Проверете URL адреса и опитайте отново.');
  }

  let result = parts.join('\n\n');
  result = result.replace(/__name\s+is\s+not\s+defined/gim, '[грешка при зареждане]');
  return result;
}

export { isValidCaisUrl };
