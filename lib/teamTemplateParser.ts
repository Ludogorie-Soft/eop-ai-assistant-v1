/**
 * Team template DOCX parser.
 * Positions in the team template are plain-text headings (bold/styled),
 * followed by description text until the next position heading.
 * E.g. "Ръководител на проекта" then paragraphs of responsibilities.
 */

import mammoth from 'mammoth';

export interface TeamPosition {
  title: string;
  body: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Detect whether an HTML element is a position heading.
 * Position headings are typically short, bold paragraphs containing a role name.
 */
function isPositionHeading(paragraphHtml: string): boolean {
  const hasBold = /<strong>|<b>/i.test(paragraphHtml);
  const text = htmlToText(paragraphHtml).trim();
  if (!text || text.length < 3) return false;

  // Too long for a heading (body text that happens to be bold)
  if (text.length > 120) return false;

  // Skip numbered sub-sections like "1. Етап: Подготвителни дейности"
  if (/^\d+\.\s*(Етап|Основни|Задължения|Отговорности)/i.test(text)) return false;

  // Skip checkbox-style lines
  if (/^[✅🔹]/.test(text)) return false;

  // Skip lines that look like generic sub-headings within a position body
  if (/^(Ключови експерти|Основна цел)/i.test(text)) return false;

  // A heading should contain Cyrillic characters (it's a Bulgarian role name)
  const hasCyrillic = /[А-Яа-яЁё]/.test(text);
  if (!hasCyrillic) return false;

  const rolePattern = /ръководител|специалист|експерт|лице\s+по|координатор|инженер|геодез/i;

  // If it doesn't end with punctuation and is short-ish, likely a heading
  const endsWithPunctuation = /[.;:!?]$/.test(text);
  if (hasBold && text.length <= 80 && !endsWithPunctuation) return true;

  // Line with typical role keywords (even if not bold)
  if (rolePattern.test(text) && text.length <= 80 && !endsWithPunctuation) {
    return true;
  }

  return false;
}

/**
 * Parse team template DOCX buffer into position blocks.
 * Each position = heading line + all text until next heading.
 */
export async function parseTeamTemplateDocx(
  buffer: Buffer,
): Promise<TeamPosition[]> {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value ?? '';

  // Split HTML by paragraph tags
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(html)) !== null) {
    paragraphs.push(match[0]);
  }

  if (paragraphs.length === 0) return [];

  const positions: TeamPosition[] = [];
  let currentTitle: string | null = null;
  let currentBodyParts: string[] = [];

  for (const p of paragraphs) {
    if (isPositionHeading(p)) {
      if (currentTitle && currentBodyParts.length > 0) {
        const body = currentBodyParts.join('\n\n').trim();
        if (body.length > 20) {
          positions.push({ title: currentTitle, body });
        }
      }
      currentTitle = htmlToText(p).trim();
      currentBodyParts = [];
    } else if (currentTitle) {
      const text = htmlToText(p).trim();
      if (text) {
        currentBodyParts.push(text);
      }
    }
  }

  // Flush last position
  if (currentTitle && currentBodyParts.length > 0) {
    const body = currentBodyParts.join('\n\n').trim();
    if (body.length > 20) {
      positions.push({ title: currentTitle, body });
    }
  }

  return positions;
}

