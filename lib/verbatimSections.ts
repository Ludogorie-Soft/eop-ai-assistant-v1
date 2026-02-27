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

/** Patterns for page footers, document part markers and table artefacts to strip from verbatim sections */
const PAGE_FOOTER_EMAIL = /\n[^\n]*(е-mail:|@)[^\n]*\s{10,}\d{1,2}\s*$/gm;
const DOC_PART_MARKER = /\n\s*Част:?\s*Пътна\s*\d+\/\d+\s*$/gim;
const KOLICHESTVENA_PAGE = /\n\s*КОЛИЧЕСТВЕНА\s+СМЕТКА\s*\d+\/\d+\s*$/gim;
const PAGE_NUMBER_ONLY = /\n\s{15,}\d{1,2}\s*$/gm;
const TABLE_HEADER_LIKE = /^\s*m\s+\(m\)\s+шир\s+/im;
const SIGNATURE_LINE = /\n\s*Съставил\s*:[\s\S]*?(?:\/[^/]+\/|$)/gm;
const MULTI_SPACE_NUMBER = /\n[^\n]*\s{20,}\d{1,2}\s*$/gm;

// ---------------------------------------------------------------------------
// Stop patterns - used to find section boundaries
// ---------------------------------------------------------------------------

/** Patterns that indicate the END of "Съществуващо положение" / "Текущо състояние" */
const EXISTING_STATE_STOP_PATTERNS = [
  /^\d*\.?\s*Проектно\s+решение/im,
  /^\d*\.?\s*ПРЕДВИДЕНИ\s+РАБОТИ/im,
  /^\d*\.?\s*ПОЛСК[ИО]\s*[–-]\s*ИЗМЕРВАТЕЛНИ/im,
  /^\d*\.?\s*ПОЛСКИ\s+ИЗМЕРВАТЕЛНИ/im,
  /^III\.\s+/m,
  /^IV\.\s+/m,
  /^---\s+.+\s+---$/m,
];

/** Patterns that indicate the END of "Проектно решение" */
const PROJECT_SOLUTION_STOP_PATTERNS = [
  /^Сметка\s+\d+/im,
  /^КОЛИЧЕСТВЕНА\s+СМЕТКА/im,
  /^\s*Съставил:\s/im,
  /^---\s+.+\s+---$/m,
  /^ВЕДОМОСТ\s+No/im,
  /^ЕЛЕМЕНТИ\s+НА\s+ВЕРТИКАЛНИТЕ/im,
  /^НИВЕЛЕТНИ\s+КОТИ/im,
  /^КООРДИНАТИ\s+НА\s+ГЛАВНИ/im,
  /^ОБЕМ\s+НА\s+АСФАЛТОБЕТОНА/im,
  /^ДАННИ\s+ЗА\s+ТЕРЕНА/im,
  /^\s*Вид\s+нивелета\s*:\s*прави/im,
  /^IV\.\s+СРОК\s+ЗА\s+ИЗПЪЛНЕНИЕ/im,
  /^V\.\s+ИЗИСКВАНИЯ/im,
  /^\d+\.\s+ИЗИСКВАНИЯ\s+ЗА\s+СЪОТВЕТСТВИЕ/im,
  /^\d+\.\s+ОБЩИ\s+ИЗИСКВАНИЯ\s+ПО\s+ЗУТ/im,
  /^\d+\.\s+ИЗИСКВАНИЯ\s+КЪМ\s+СТРОИТЕЛНИТЕ\s+ПРОДУКТИ/im,
  /^\d+\.\s+ГАРАНЦИОННИ\s+СРОКОВЕ/im,
  /^\d+\.\s+ОПИСАНИЕ\s+НА\s+ВИДОВЕТЕ\s+ДЕЙНОСТИ/im,
];

// ---------------------------------------------------------------------------
// Boilerplate stripping
// ---------------------------------------------------------------------------

function stripBoilerplate(text: string): string {
  if (!text?.trim()) return text;
  let out = text
    .replace(
      /Този документ е съставен[\s\S]*?Европейския съюз и\/или ДФЗ\.?/gi,
      ''
    )
    .replace(/\n\s*Страница\s+\d+\s+от\s+\d+\s*\n/gi, '\n')
    .replace(
      /\n\s*ОБЩИНА\s+[А-ЯA-Zа-яa-z\s]+\s*\n\s*MUNICIPALITY\s+[A-Za-z\s]+\s*/gi,
      '\n'
    )
    .replace(PAGE_FOOTER_EMAIL, '')
    .replace(DOC_PART_MARKER, '')
    .replace(KOLICHESTVENA_PAGE, '')
    .replace(PAGE_NUMBER_ONLY, '')
    .replace(SIGNATURE_LINE, '')
    .replace(MULTI_SPACE_NUMBER, '');

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

  out = out.replace(/\s{10,}\d{1,2}\s*$/gm, '');

  out = out
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/Съставил\s*:/i.test(t)) return false;
      if (/^\d{4}\s*г\.?\s*$/.test(t)) return false;
      if (/^гр\.\s*\S+\s*$/i.test(t)) return false;
      if (/^\/\s*инж\.\s/i.test(t)) return false;
      if (/^\/[^/]+\/\s*$/.test(t)) return false;
      if (/^\.{5,}/.test(t)) return false;
      return true;
    })
    .join('\n');

  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/** Strip KSS data that may have leaked into a verbatim section */
function stripKssFromSection(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inKss = false;

  for (const line of lines) {
    const t = line.trim();

    if (!t) {
      if (!inKss) out.push(line);
      continue;
    }

    if (/^Сметка\s+\d+/i.test(t) || /^КОЛИЧЕСТВЕНА\s+СМЕТКА/i.test(t)) {
      inKss = true;
      continue;
    }
    if (/^ВЕДОМОСТ\s+No/i.test(t)) {
      inKss = true;
      continue;
    }

    if (inKss) {
      if (/^\d+\.\s*\d+\s+[А-ЯA-Z]/.test(t) && !/^\d{3,4}/.test(t)) {
        inKss = false;
      } else {
        continue;
      }
    }

    if (/^\d{3,4}\s+/.test(t) && /\d+\s*(м[23²³]?|бр\.?|тон|кг)\s*$/i.test(t)) continue;
    if (/^Всичко:\s*[\d,.]+/i.test(t)) continue;
    if (/^-\s*съгласно\s+(Ведомост|Чертеж)/i.test(t)) continue;
    if (/^\[\s*U\d+\s*\]/i.test(t)) continue;
    if (/^Позиция\s+No\s/i.test(t)) continue;
    if (/^Наименование\s+на\s+видовете\s+работи/i.test(t)) continue;
    if (/Съставил\s*:/i.test(t)) continue;
    if (/^\s*\/\s*инж\.\s/i.test(t)) continue;
    if (/^\/[^/]+\/\s*$/.test(t)) continue;
    if (/^\d{4}\s*г\.?\s*$/.test(t)) continue;
    if (/^гр\.\s*\S+\s*$/i.test(t)) continue;
    if (/^\.{5,}/.test(t)) continue;

    out.push(line);
  }

  let result = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  result = result.replace(/\s*\d{4}\s*г\.?\s*$/i, '').trim();
  result = result.replace(/\s*гр\.\s*\S+\s*$/i, '').trim();
  return result;
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/** Find earliest match index across multiple stop patterns */
function findEarliestStop(text: string, patterns: RegExp[]): number {
  let earliest = text.length;
  for (const p of patterns) {
    const m = text.match(new RegExp(p.source, p.flags.includes('m') ? 'm' : 'm'));
    if (m?.index != null && m.index < earliest) {
      earliest = m.index;
    }
  }
  return earliest;
}

function findSection(
  text: string,
  headingRegex: RegExp,
  stopPatterns: RegExp[]
): string | null {
  const match = text.match(headingRegex);
  if (!match || match.index == null) return null;

  const start = match.index + match[0].length;
  const afterHeading = text.slice(start).replace(/^\s*[\r\n]+/, '').trim();

  const end = findEarliestStop(afterHeading, stopPatterns);
  const body = afterHeading.slice(0, end).trim();
  return body.length > 0 ? body : null;
}

function findExistingStateSection(text: string): string | null {
  const match = text.match(HEADING_EXISTING_STATE);
  if (!match || match.index == null) return null;

  const start = match.index + match[0].length;
  const afterHeading = text.slice(start).replace(/^\s*[\r\n]+/, '').trim();

  const end = findEarliestStop(afterHeading, EXISTING_STATE_STOP_PATTERNS);
  const body = afterHeading.slice(0, end).trim();
  return body.length > 0 ? body : null;
}

/** For compound project solution, take only up to start of second object/position to avoid huge repeat */
const START_SECOND_OBJECT = /^\s*2\.\s*ОБЕКТ\s*:?/im;
const START_SECOND_POSITION = /ОБОСОБЕНА\s+ПОЗИЦИЯ\s+No\s+2\b/im;

function findProjectSolutionCompound(text: string): string | null {
  const match = text.match(HEADING_CONTAINS_PROJECT_SOLUTION);
  if (!match || match.index == null) return null;

  const start = match.index + match[0].length;
  const afterHeading = text.slice(start).replace(/^\s*[\r\n]+/, '').trim();

  let end = findEarliestStop(afterHeading, PROJECT_SOLUTION_STOP_PATTERNS);
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

  const currentState =
    findSection(rawText, HEADING_CURRENT_STATE, EXISTING_STATE_STOP_PATTERNS) ??
    findExistingStateSection(rawText);

  const projectSolution =
    findSection(rawText, HEADING_PROJECT_SOLUTION, PROJECT_SOLUTION_STOP_PATTERNS) ??
    findProjectSolutionCompound(rawText);

  return { currentState, projectSolution };
}

/** Clean a raw verbatim section (strip boilerplate and KSS) */
export function cleanVerbatimSection(raw: string): string {
  let cleaned = stripBoilerplate(raw).trim();
  cleaned = stripKssFromSection(cleaned);
  return cleaned;
}

/** Build final introduction by combining AI-generated intro, verbatim section 4, and paraphrased section 5 */
export function buildFinalIntroduction(
  introductionText: string,
  currentState: string | null,
  paraphrasedProjectSolution: string | null,
): string {
  const parts = [introductionText.trim()];

  if (currentState?.trim()) {
    parts.push(`4. Текущо състояние\n\n${currentState}`);
  }
  if (paraphrasedProjectSolution?.trim()) {
    parts.push(`5. Проектно решение\n\n${paraphrasedProjectSolution}`);
  }

  return parts.join('\n\n');
}

/** @deprecated Use buildFinalIntroduction with separate extraction and paraphrasing */
export function appendVerbatimSections(
  introductionText: string,
  rawText: string
): string {
  const { currentState, projectSolution } = extractVerbatimSections(rawText);
  const cleanedState = currentState ? cleanVerbatimSection(currentState) : null;
  const cleanedSolution = projectSolution ? cleanVerbatimSection(projectSolution) : null;
  return buildFinalIntroduction(introductionText, cleanedState, cleanedSolution);
}
