/**
 * CAIS (Centralized Automated Information System) fetcher
 * Fetches public procurement pages, extracts visible text, and downloads attachments
 */

import { extractTextFromBufferByUrl } from './fileParser';

const CAIS_ALLOWED_HOSTS = [
  'www.cais.bg',
  'cais.bg',
  'opendata.cais.bg',
  'eop.bg',
  'www.eop.bg',
  'app.eop.bg',
];

const MAX_CONTENT_LENGTH = 2 * 1024 * 1024; // 2MB
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024; // 100MB per attachment
const ATTACHMENT_FETCH_TIMEOUT_MS = 30000;

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

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function tryFetchApiForDocuments(
  pageUrl: string
): Promise<string[]> {
  try {
    const url = new URL(pageUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const id = pathParts[pathParts.length - 1];
    if (!id || !/^\d+$/.test(id)) return [];

    const apiBase = `${url.origin}/api`;
    const candidates = [
      `${apiBase}/oday/${id}`,
      `${apiBase}/oday/${id}/documents`,
      `${apiBase}/tenders/${id}`,
      `${apiBase}/tenders/${id}/documents`,
    ];

    for (const apiUrl of candidates) {
      try {
        const res = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'EOP-AI-Assistant/1.0 (Tender Technical Generator)',
            Accept: 'application/json',
          },
        });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) continue;

        const data = (await res.json()) as unknown;
        const links: string[] = [];
        const collect = (obj: unknown): void => {
          if (typeof obj === 'string' && /\.(pdf|docx|doc)(?:\?|$)/i.test(obj)) {
            try {
              const absolute = new URL(obj, pageUrl);
              if (absolute.protocol === 'https:') links.push(absolute.href);
            } catch {
              /* skip */
            }
          } else if (Array.isArray(obj)) {
            obj.forEach(collect);
          } else if (obj && typeof obj === 'object') {
            Object.values(obj).forEach(collect);
          }
        };
        collect(data);
        if (links.length > 0) return links;
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function extractDocumentLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const urlInTextRegex = /https?:\/\/[^\s"'<>]+\.(pdf|docx|doc)(?:\?[^\s"'<>]*)?/gi;
  let m;

  while ((m = hrefRegex.exec(html)) !== null) {
    const href = m[1].trim();
    if (/\.(pdf|docx|doc)(?:\?|$)/i.test(href)) {
      try {
        const absolute = new URL(href, base);
        if (absolute.protocol === 'https:' && absolute.hostname) {
          links.add(absolute.href);
        }
      } catch {
        /* skip invalid */
      }
    }
  }

  while ((m = urlInTextRegex.exec(html)) !== null) {
    try {
      const absolute = new URL(m[0]);
      if (absolute.protocol === 'https:' && absolute.hostname) {
        links.add(absolute.href);
      }
    } catch {
      /* skip invalid */
    }
  }

  return [...links];
}

async function fetchAttachment(
  url: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!isAllowedAttachmentHost(url)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ATTACHMENT_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'EOP-AI-Assistant/1.0 (Tender Technical Generator; +https://eop.bg)',
      },
    });

    if (!response.ok) return null;

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_ATTACHMENT_SIZE) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_ATTACHMENT_SIZE) return null;

    const disposition = response.headers.get('content-disposition');
    let filename = new URL(url).pathname.split('/').pop() ?? 'document';
    if (disposition) {
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i)
        ?? disposition.match(/filename=["']?([^"';]+)["']?/i);
      if (match?.[1]) {
        filename = decodeURIComponent(match[1].trim());
      }
    }

    return { buffer, filename };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchCaisContent(url: string): Promise<string> {
  if (!isValidCaisUrl(url)) {
    throw new Error(
      'Invalid CAIS URL. Only https URLs from cais.bg, eop.bg or opendata.cais.bg are allowed.'
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'EOP-AI-Assistant/1.0 (Tender Technical Generator; +https://eop.bg)',
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(`CAIS fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      throw new Error('CAIS URL did not return HTML content');
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_LENGTH) {
      throw new Error('CAIS page content exceeds size limit');
    }

    const html = await response.text();
    if (html.length > MAX_CONTENT_LENGTH) {
      throw new Error('CAIS page content exceeds size limit');
    }

    const pageText = stripHtmlTags(html);
    const parts: string[] = [];

    if (pageText.trim()) {
      parts.push(`--- CAIS: ${url} ---\n\n${pageText}`);
    }

    let docLinks = extractDocumentLinks(html, url);
    if (docLinks.length === 0) {
      docLinks = await tryFetchApiForDocuments(url);
    }
    const seen = new Set<string>();

    for (const docUrl of docLinks) {
      if (seen.has(docUrl)) continue;
      seen.add(docUrl);

      const attachment = await fetchAttachment(docUrl);
      if (!attachment) continue;

      const text = await extractTextFromBufferByUrl(attachment.buffer, docUrl);
      if (text.trim()) {
        parts.push(`--- ${attachment.filename} ---\n\n${text}`);
      }
    }

    return parts.join('\n\n');
  } finally {
    clearTimeout(timeoutId);
  }
}

export { isValidCaisUrl };
