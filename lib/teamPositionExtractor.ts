/**
 * Extracts required team positions from "Документация за участие" raw text.
 * Looks for sections describing minimum personnel/staff requirements.
 */

export interface RequiredPosition {
  name: string;
  requirements: string;
}

const SECTION_START_PATTERNS = [
  /(?:персонал|ръководен\s+(?:екип|състав)|минимален\s+(?:екип|състав)|професионална\s+компетентност|ключови\s+експерти|екип\s+за\s+изпълнение)[^\n]*/i,
  /участникът\s+(?:следва|трябва)\s+да\s+(?:разполага|осигури|предложи)\s+с\s+(?:\S+\s+)?(?:персонал|екип|ключови)/i,
  /изисквания\s+(?:към|за)\s+(?:персонал|екип|ключови\s+експерти)/i,
];

const SECTION_END_PATTERNS = [
  /^\d+\.\d+\.\d+\.\s+(?!.*(?:ръководител|експерт|специалист|лице\s+по|координатор|инженер))/im,
  /^\d+\.\d+\.\s+(?:Участникът\s+следва|Минимални\s+изисквания\s+за\s+техническ)/im,
  /критери[ий]\s+за\s+подбор/i,
  /икономическ[ои]\s+и\s+финансов/i,
  /технически\s+(?:и\s+професионални\s+)?способности/i,
];

/** Known role keywords for detecting position name lines within the section. */
const ROLE_KEYWORDS = [
  /ръководител/i,
  /технически\s+ръководител/i,
  /специалист/i,
  /експерт/i,
  /длъжностно\s+лице/i,
  /координатор/i,
  /инженер/i,
  /геодез/i,
  /отговорник/i,
  /ЗБУТ/,
  /контрол\s+на\s+качеството/i,
];

function isRoleLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200) return false;

  // Numbered role line: "1. Ръководител на проекта" or "- Ръководител на проекта"
  const numberedRole = /^(?:\d+[.)]\s*|-\s*|•\s*|–\s*)(.+)/;
  const m = trimmed.match(numberedRole);
  const text = m ? m[1].trim() : trimmed;

  return ROLE_KEYWORDS.some((re) => re.test(text));
}

function extractRoleName(line: string): string {
  let cleaned = line.trim();

  // Strip leading numbering/bullets
  cleaned = cleaned.replace(/^(?:\d+[.)]\s*|-\s*|•\s*|–\s*)/, '').trim();

  // If there's a dash separator, the role name is typically before it
  const dashSplit = cleaned.split(/\s+[-–—]\s+/);
  if (dashSplit.length > 1 && dashSplit[0].length >= 5) {
    return dashSplit[0].trim();
  }

  // If there's a colon, the role name is before it
  const colonSplit = cleaned.split(/:\s*/);
  if (colonSplit.length > 1 && colonSplit[0].length >= 5) {
    return colonSplit[0].trim();
  }

  // Take up to the first comma if short enough
  const commaSplit = cleaned.split(',');
  if (commaSplit.length > 1 && commaSplit[0].length >= 5 && commaSplit[0].length <= 80) {
    return commaSplit[0].trim();
  }

  // Truncate if too long
  if (cleaned.length > 80) {
    return cleaned.slice(0, 80).replace(/\s+\S*$/, '').trim();
  }

  return cleaned;
}

function extractRequirements(line: string, followingLines: string[]): string {
  const parts: string[] = [];

  // Requirements from the same line (after dash/colon)
  const afterDash = line.replace(/^[^–—-]+[-–—]\s*/, '');
  if (afterDash !== line.trim()) {
    parts.push(afterDash.trim());
  }

  // Collect indented or continuation lines that look like requirements
  for (const fl of followingLines) {
    const t = fl.trim();
    if (!t) break;
    if (isRoleLine(fl)) break;
    if (/^\d+\.\d+/.test(t)) break;
    parts.push(t);
  }

  return parts.join(' ').trim();
}

/** Extract required positions from the documentation portion of rawText. */
export function extractRequiredPositions(rawText: string): RequiredPosition[] {
  if (!rawText?.trim()) return [];

  const lines = rawText.split(/\r?\n/);

  // Collect ALL candidate section starts (pattern may fire on false positives earlier in the doc)
  const sectionStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_START_PATTERNS.some((p) => p.test(lines[i]))) {
      sectionStarts.push(i);
    }
  }

  if (sectionStarts.length === 0) return [];

  // Try each candidate in order; use the first one that actually contains role lines
  for (const sectionStart of sectionStarts) {
    // Find the end of this section
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (SECTION_END_PATTERNS.some((p) => p.test(lines[i]))) {
        sectionEnd = i;
        break;
      }
    }
    // Cap section size (increased to handle large docs with many preamble lines)
    sectionEnd = Math.min(sectionEnd, sectionStart + 300);

    const sectionLines = lines.slice(sectionStart, sectionEnd);

    // Skip this candidate if no role lines are found within it
    if (!sectionLines.some((l) => isRoleLine(l))) continue;

    const positions: RequiredPosition[] = [];
    for (let i = 0; i < sectionLines.length; i++) {
      if (isRoleLine(sectionLines[i])) {
        const name = extractRoleName(sectionLines[i]);
        const followingLines = sectionLines.slice(i + 1, i + 15);
        const requirements = extractRequirements(sectionLines[i], followingLines);

        if (name.length >= 3) {
          positions.push({ name, requirements });
        }
      }
    }

    if (positions.length > 0) return positions;
  }

  return [];
}

