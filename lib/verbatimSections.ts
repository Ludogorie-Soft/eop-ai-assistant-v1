/**
 * Extract "Текущо състояние" / "Съществуващо положение" and "Проектно решение" verbatim from raw text.
 * Searches across all source content (CAIS + attached files).
 * Supports alternative headings used in technical specs (e.g. "СЪЩЕСТВУВАЩО ПОЛОЖЕНИЕ").
 */

/** "Текущо състояние" or "Съществуващо положение" (technical specs often use "4. СЪЩЕСТВУВАЩО ПОЛОЖЕНИЕ") */
const HEADING_CURRENT_STATE = /^\d*\.?\s*Текущо\s+състояние\s*$/im;
const HEADING_EXISTING_STATE = /^\d*\.?\s*съществуващо\s+положение\s*$/im;

/** "Проектно решение" as standalone or inside compound heading */
const HEADING_PROJECT_SOLUTION = /^\d*\.?\s*Проектно\s+решение\s*$/im;
const HEADING_CONTAINS_PROJECT_SOLUTION = /^[\d.]*\s*[^\n]*проектно\s+решение[^\n]*$/im;

/** Stop before next section */
const STOP_AT_PROJECT_SOLUTION = /^\d*\.?\s*Проектно\s+решение\s*$/im;
const STOP_AT_CURRENT_STATE = /^\d*\.?\s*Текущо\s+състояние\s*$/im;
const STOP_AT_EXISTING_STATE = /^\d*\.?\s*съществуващо\s+положение\s*$/im;
const STOP_AT_5_PREDVIDENI = /^\d*\.?\s*ПРЕДВИДЕНИ\s+РАБОТИ/im;
const STOP_AT_III = /^\s*III\.\s+/m;

/** Patterns for page footers, document part markers and table artefacts to strip from verbatim sections */
const PAGE_FOOTER_EMAIL = /\n[^\n]*(е-mail:|@)[^\n]*\s{10,}\d{1,2}\s*$/gm;
const DOC_PART_MARKER = /\n\s*Част:?\s*Пътна\s*\d+\/\d+\s*$/gim;
const KOLICHESTVENA_PAGE = /\n\s*КОЛИЧЕСТВЕНА\s+СМЕТКА\s*\d+\/\d+\s*$/gim;
const PAGE_NUMBER_ONLY = /\n\s{15,}\d{1,2}\s*$/gm;
const TABLE_HEADER_LIKE = /^\s*m\s+\(m\)\s+шир\s+/im;
const SIGNATURE_LINE = /\n\s*Съставил:\s*\n\s*[^\n]*\/\s*[^\n\/]+\s*\/\s*$/gm;
const MULTI_SPACE_NUMBER = /\n[^\n]*\s{20,}\d{1,2}\s*$/gm;

/** Remove EU disclaimer, page lines, and repeated header blocks to shorten verbatim output */
function stripBoilerplate(text: string): string {
  if (!text?.trim()) return text;
  let out = text
    .replace(
      /Този документ е съставен[\s\S]*?Европейския съюз и\/или ДФЗ\.?/gi,
      ''
    )
    .replace(/\n\s*Страница\s+\d+\s+от\s+\d+\s*\n/gi, '\n')
    .replace(
      /\n\s*ОБЩИНА\s+КИРКОВО\s*\n\s*MUNICIPALITY\s+KIRKOVO\s*/gi,
      '\n'
    )
    // Footer lines: company/email followed by many spaces and page number
    .replace(PAGE_FOOTER_EMAIL, '')
    .replace(DOC_PART_MARKER, '')
    .replace(KOLICHESTVENA_PAGE, '')
    .replace(PAGE_NUMBER_ONLY, '')
    .replace(SIGNATURE_LINE, '')
    .replace(MULTI_SPACE_NUMBER, '');

  // Drop lines that are only table-header noise or page markers
  out = out
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (TABLE_HEADER_LIKE.test(t)) return false;
      if (/^Част:?\s*Пътна\s*\d+\/\d+$/i.test(t)) return false;
      if (/^КОЛИЧЕСТВЕНА\s+СМЕТКА\s*\d+\/\d+$/i.test(t)) return false;
      if (/^\d+\/\d+$/.test(t) && t.length <= 4) return false;
      return true;
    })
    .join('\n');

  // Remove trailing page numbers (many spaces + 1–2 digits) at end of lines
  out = out.replace(/\s{10,}\d{1,2}\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  // Normalise single newlines between paragraphs
  return out;
}

/** For compound project solution, take only up to start of second object/position to avoid huge repeat */
const START_SECOND_OBJECT = /^\s*2\.\s*ОБЕКТ\s*:?/im;
/** Alternative: "ОБОСОБЕНА ПОЗИЦИЯ No 2" (used in docs with обособени позиции) */
const START_SECOND_POSITION = /ОБОСОБЕНА\s+ПОЗИЦИЯ\s+No\s+2\b/im;

function findSection(
  text: string,
  headingRegex: RegExp,
  stopAtRegex: RegExp
): string | null {
  const match = text.match(headingRegex);
  if (!match || match.index == null) return null;

  const start = match.index + match[0].length;
  const afterHeading = text.slice(start).replace(/^\s*[\r\n]+/, '').trim();

  const stopMatch = afterHeading.match(new RegExp(stopAtRegex.source, 'm'));
  const end = stopMatch?.index ?? afterHeading.length;
  const body = afterHeading.slice(0, end).trim();
  return body.length > 0 ? body : null;
}

/** Find "Съществуващо положение" block; stop at "5. ПРЕДВИДЕНИ" or next "4. СЪЩЕСТВУВАЩО" or "Проектно решение" */
function findExistingStateSection(text: string): string | null {
  const match = text.match(HEADING_EXISTING_STATE);
  if (!match || match.index == null) return null;

  const start = match.index + match[0].length;
  let afterHeading = text.slice(start).replace(/^\s*[\r\n]+/, '').trim();

  const stops = [
    afterHeading.match(/\d*\.?\s*ПРЕДВИДЕНИ\s+РАБОТИ/im),
    afterHeading.match(HEADING_CONTAINS_PROJECT_SOLUTION),
    afterHeading.match(STOP_AT_EXISTING_STATE),
  ];
  let end = afterHeading.length;
  for (const m of stops) {
    if (m?.index != null && m.index < end) end = m.index;
  }
  const body = afterHeading.slice(0, end).trim();
  return body.length > 0 ? body : null;
}

/** Find "Проектно решение" when it appears in a compound heading; take content until III. or ОБЩИ ИЗИСКВАНИЯ */
function findProjectSolutionCompound(text: string): string | null {
  const match = text.match(HEADING_CONTAINS_PROJECT_SOLUTION);
  if (!match || match.index == null) return null;

  const start = match.index + match[0].length;
  let afterHeading = text.slice(start).replace(/^\s*[\r\n]+/, '').trim();

  const stopIII = afterHeading.match(STOP_AT_III);
  const stopObshti = afterHeading.match(/^\s*III\.\s*ОБЩИ\s+ИЗИСКВАНИЯ/im);
  let end = stopIII?.index ?? stopObshti?.index ?? afterHeading.length;
  const secondObj = afterHeading.slice(0, end).match(START_SECOND_OBJECT);
  const secondPos = afterHeading.slice(0, end).match(START_SECOND_POSITION);
  if (secondObj?.index != null) end = Math.min(end, secondObj.index);
  if (secondPos?.index != null) end = Math.min(end, secondPos.index);
  const body = afterHeading.slice(0, end).trim();
  return body.length > 50 ? body : null;
}

export function extractVerbatimSections(rawText: string): {
  currentState: string | null;
  projectSolution: string | null;
} {
  if (!rawText?.trim()) {
    return { currentState: null, projectSolution: null };
  }

  let currentState =
    findSection(rawText, HEADING_CURRENT_STATE, STOP_AT_PROJECT_SOLUTION) ??
    findExistingStateSection(rawText);

  let projectSolution =
    findSection(rawText, HEADING_PROJECT_SOLUTION, STOP_AT_CURRENT_STATE) ??
    findSection(rawText, HEADING_PROJECT_SOLUTION, STOP_AT_EXISTING_STATE) ??
    findProjectSolutionCompound(rawText);

  return { currentState, projectSolution };
}

/** Append verbatim sections 4 and 5 to introduction text if found in raw text */
export function appendVerbatimSections(
  introductionText: string,
  rawText: string
): string {
  const { currentState, projectSolution } = extractVerbatimSections(rawText);

  const parts = [introductionText.trim()];

  if (currentState?.trim()) {
    parts.push(`4. Текущо състояние\n\n${stripBoilerplate(currentState).trim()}`);
  }
  if (projectSolution?.trim()) {
    const cleaned = stripBoilerplate(projectSolution).trim();
    // Ensure subsections 5.1, 5.2, … start on a new line for clearer structure
    const withNewlines = cleaned.replace(/\s+(\d+)\.(\d+)\s+([А-ЯA-Z])/g, '\n\n$1.$2 $3');
    parts.push(`5. Проектно решение\n\n${withNewlines}`);
  }

  return parts.join('\n\n');
}
