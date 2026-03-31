/**
 * AI-powered Introduction generator using LangChain
 * Server-side only
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createLLM } from './langchainClient';
import {
  INTRODUCTION_SYSTEM_PROMPT,
  INTRODUCTION_USER_PROMPT_TEMPLATE,
  CURRENT_STATE_SYSTEM_PROMPT,
  CURRENT_STATE_USER_PROMPT_TEMPLATE,
  PROJECT_SOLUTION_SYSTEM_PROMPT,
  PROJECT_SOLUTION_USER_PROMPT_TEMPLATE,
} from './prompts/introductionPrompt';
import { searchSimilarSections } from './offerEmbeddings';

/** Fetch RAG context from stored offer sections. Fails silently. */
async function fetchIntroductionRagContext(sourceText: string): Promise<string> {
  try {
    const examples = await searchSimilarSections(sourceText.slice(0, 2000), 'introduction', 3);
    if (!examples.length) return '';
    const parts = examples.map((e, i) =>
      `--- Пример ${i + 1} (от минала оферта) ---\n${e.plain_text.slice(0, 3000)}`
    );
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

export async function generateIntroduction(sourceText: string): Promise<string> {
  if (!sourceText?.trim()) {
    throw new Error('Текстът на изходния документ е задължителен');
  }

  const cleanedSource = cleanSourceText(sourceText);

  // Fetch RAG examples from past offers (non-blocking, fails silently)
  const ragContext = await fetchIntroductionRagContext(cleanedSource);

  const llm = createLLM({
    temperature: 0.2,
    maxTokens: 16384,
  });

  const messages: [string, string][] = [['system', INTRODUCTION_SYSTEM_PROMPT]];
  if (ragContext) {
    messages.push([
      'human',
      `ПРИМЕРИ ОТ ПРЕДИШНИ ОФЕРТИ (използвай като стилов ориентир — НЕ ги преписвай):\n\n${ragContext}`,
    ]);
    messages.push(['ai', 'Разбрах. Ще използвам тези примери само за стил и структура, без да ги копирам.']);
  }
  messages.push(['human', INTRODUCTION_USER_PROMPT_TEMPLATE]);

  const prompt = ChatPromptTemplate.fromMessages(messages);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    sourceText: cleanedSource.slice(0, 80000),
  });

  const content = response.content;
  if (typeof content !== 'string') {
    throw new Error('Лош формат на отговора от LLM');
  }

  let out = stripMarkdownBold(content.trim());
  out = cleanIntroductionOutput(out);
  return out;
}

export async function paraphraseCurrentState(rawCurrentState: string): Promise<string> {
  if (!rawCurrentState?.trim()) {
    return rawCurrentState;
  }

  const llm = createLLM({
    temperature: 0.2,
    maxTokens: 16384,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', CURRENT_STATE_SYSTEM_PROMPT],
    ['human', CURRENT_STATE_USER_PROMPT_TEMPLATE],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    currentState: rawCurrentState.slice(0, 40000),
  });

  const content = response.content;
  if (typeof content !== 'string') {
    return rawCurrentState;
  }

  let out = stripMarkdownBold(content.trim());
  out = cleanIntroductionOutput(out);
  return out;
}

export async function paraphraseProjectSolution(rawProjectSolution: string): Promise<string> {
  if (!rawProjectSolution?.trim()) {
    return rawProjectSolution;
  }

  const llm = createLLM({
    temperature: 0.2,
    maxTokens: 16384,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', PROJECT_SOLUTION_SYSTEM_PROMPT],
    ['human', PROJECT_SOLUTION_USER_PROMPT_TEMPLATE],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    projectSolution: rawProjectSolution.slice(0, 40000),
  });

  const content = response.content;
  if (typeof content !== 'string') {
    return rawProjectSolution;
  }

  let out = stripMarkdownBold(content.trim());
  out = cleanIntroductionOutput(out);
  return out;
}

function stripMarkdownBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// ---------------------------------------------------------------------------
// Document-level filtering
// ---------------------------------------------------------------------------

interface DocSection {
  filename: string;
  body: string;
}

/** Split the merged rawText into per-file sections using --- filename --- markers */
function splitByFileMarkers(text: string): DocSection[] {
  const marker = /^---\s+(.+?)\s+---$/gm;
  const sections: DocSection[] = [];
  let match: RegExpExecArray | null;
  const positions: { filename: string; start: number }[] = [];

  while ((match = marker.exec(text)) !== null) {
    positions.push({ filename: match[1], start: match.index + match[0].length });
  }

  if (positions.length === 0) {
    return [{ filename: '', body: text }];
  }

  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length
      ? text.lastIndexOf('---', positions[i + 1].start)
      : text.length;
    sections.push({
      filename: positions[i].filename,
      body: text.slice(positions[i].start, end).trim(),
    });
  }

  return sections;
}

type DocType =
  | 'contract'
  | 'documentation'
  | 'techSpec'
  | 'parameters'
  | 'explanatoryNote'
  | 'kss'
  | 'other';

function classifyDocument(filename: string, bodyStart: string): DocType {
  const fn = filename.toLowerCase();
  const bs = bodyStart.toLowerCase();

  if (/проект\s*(на|за)\s*договор/i.test(fn) || /проект\s*(на|за)\s*договор/i.test(bs))
    return 'contract';
  if (/документация\s*(за\s*участие)?/i.test(fn) || /указания\s*за\s*участие/i.test(bs))
    return 'documentation';
  if (/техническ[аи]\s*спецификаци[яи]/i.test(fn) || /техническ[аи]\s*спецификаци[яи]/i.test(bs))
    return 'techSpec';
  if (/параметри/i.test(fn))
    return 'parameters';
  if (/количествен[аи]\s*сметк[аи]/i.test(fn) || /^кс[сc]/i.test(fn))
    return 'kss';
  if (/doc_all/i.test(fn) || /обяснителна/i.test(fn) || /пътна/i.test(fn))
    return 'explanatoryNote';

  if (/КОЛИЧЕСТВЕНА\s+СМЕТКА/i.test(bs)) return 'kss';
  if (/ПРОЕКТ\s+НА\s+ДОГОВОР/i.test(bs)) return 'contract';

  return 'other';
}

/** From a contract document, extract ONLY the guarantee responsibilities section */
function extractGuaranteeFromContract(body: string): string {
  const guaranteeStart = body.match(
    /(?:X\.|Х\.|ГАРАНЦИОННА\s+ОТГОВОРНОСТ)/im
  );
  if (!guaranteeStart?.index) return '';

  const startIdx = guaranteeStart.index;
  const afterGuarantee = body.slice(startIdx);
  const nextSection = afterGuarantee.match(
    /\n\s*(?:Х?I{1,3}|XI{1,3})\.\s+[А-ЯA-Z]/m
  );
  const endIdx = nextSection?.index
    ? startIdx + nextSection.index
    : Math.min(startIdx + 3000, body.length);

  const section = body.slice(startIdx, endIdx).trim();
  return `[Извлечено от Проект на договор – Гаранционна отговорност]\n${section}`;
}

/** From documentation for participation, extract only key parameters */
function extractKeyParamsFromDocumentation(body: string): string {
  const parts: string[] = [];

  const subjectMatch = body.match(
    /(?:предмет\s+на\s+(?:настоящата\s+)?(?:обществена(?:та)?\s+)?поръчка(?:\s+е)?:?\s*)([\s\S]{20,800}?)(?=\n\s*(?:\d+\.\s+|предвижда|пълната\s+информация|има\s+изготвен))/im
  );
  if (subjectMatch) {
    parts.push(`Предмет: ${subjectMatch[0].trim().slice(0, 1000)}`);
  }

  const criterionMatch = body.match(
    /критери[ий]\s+за\s+възлагане[^.]*?(?:„[^"]+"|най[\s–-]+ниска\s+цена|оптимално\s+съотношение)[^.]{0,200}\./im
  );
  if (criterionMatch) {
    parts.push(`Критерий за възлагане: ${criterionMatch[0].trim()}`);
  }

  const procedureMatch = body.match(
    /(?:вид\s+на\s+процедурата|публично\s+състезание|открита\s+процедура)[^.]{0,200}\./im
  );
  if (procedureMatch) {
    parts.push(`Процедура: ${procedureMatch[0].trim()}`);
  }

  const financingMatch = body.match(
    /финансиране[:\s][\s\S]{0,500}?(?=\n\s*\d+\.\d*\s+|$)/im
  );
  if (financingMatch) {
    parts.push(`Финансиране: ${financingMatch[0].trim().slice(0, 500)}`);
  }

  if (parts.length === 0) return '';
  return `[Извлечено от Документация за участие – ключови параметри]\n${parts.join('\n\n')}`;
}

/** From a technical specification, strip KSS tables but keep the rest */
function cleanTechSpec(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let inKss = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (!inKss) out.push('');
      continue;
    }

    if (isKssTableLine(line)) {
      inKss = true;
      continue;
    }

    if (inKss) {
      if (isSectionHeading(line)) {
        inKss = false;
      } else {
        continue;
      }
    }

    if (isGarbageLine(line)) continue;
    out.push(rawLine);
  }

  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

/** From the explanatory note (doc_all.pdf), strip KSS and keep descriptive sections */
function cleanExplanatoryNote(body: string): string {
  return cleanTechSpec(body);
}

// ---------------------------------------------------------------------------
// Line-level helpers
// ---------------------------------------------------------------------------

function isGarbageLine(line: string): boolean {
  if (!line.trim()) return false;
  if (EMAIL_REGEX.test(line)) return true;
  if (/e-?mail\s*:?\s*/i.test(line)) return true;
  if (/@/.test(line)) return true;
  if (/www\./i.test(line)) return true;
  if (/^[\s|=\\-—><~\u00A0\u2013\u2014#]*$/i.test(line.replace(/\d/g, ''))) return true;
  const noSpace = line.replace(/\s+/g, '');
  const total = noSpace.length;
  if (total < 3) return false;
  const alphaNumCount = (noSpace.match(/[A-Za-zА-Яа-яЁё0-9]/g) ?? []).length;
  const ratio = alphaNumCount / total;
  if (total > 15 && ratio < 0.45) return true;
  if (total >= 3 && total <= 15 && ratio < 0.55) return true;
  return false;
}

function isKssTableLine(line: string): boolean {
  if (/^КОЛИЧЕСТВЕНА\s+СМЕТКА/i.test(line)) return true;
  if (/^Сметка\s+\d+/i.test(line)) return true;
  if (/^\d{3,4}\s+/.test(line) && /\d+\s*(м[23²³]?|бр\.?|тон|кг|л\.?\s*м|км)\s*$/i.test(line))
    return true;
  if (/^Всичко:\s*[\d,.]+\s*(м[23²³]?|бр\.?|тон|кг)/i.test(line)) return true;
  if (/^-\s*съгласно\s+(Ведомост|Чертеж)/i.test(line)) return true;
  if (/^\d{3,4}[,.]?\d?\s+\w+.*\d+\s*(м[23²³]?|бр\.?|тон|кг)/i.test(line)) return true;
  if (/^\[\s*U\d+\s*\]/i.test(line)) return true;
  if (/^Позиция\s+No\s/i.test(line)) return true;
  if (/^Наименование\s+на\s+видовете\s+работи/i.test(line)) return true;
  return false;
}

function isSectionHeading(line: string): boolean {
  if (/^\d+\.\s+[А-ЯA-Z]/.test(line)) return true;
  if (/^(I{1,3}V?|V?I{0,3})\.\s+[А-ЯA-Z]/.test(line)) return true;
  if (/^ЧАСТ\s+/i.test(line)) return true;
  if (/^---/.test(line)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main clean function
// ---------------------------------------------------------------------------

/**
 * Returns per-section source file lists for AI-generated sections 1–3.
 * Each section only lists files whose extracted content is actually relevant to that section:
 *  - section1 "Предмет": parameters, documentation, techSpec, other
 *  - section2 "Дейности": techSpec, explanatoryNote, other
 *  - section3 "Нормативна рамка": techSpec, documentation, contract (guarantee)
 */
export function getIntroductionSourceFilesBySection(text: string): {
  section1: string[];
  section2: string[];
  section3: string[];
} {
  const result = { section1: [] as string[], section2: [] as string[], section3: [] as string[] };
  const sections = splitByFileMarkers(text);
  if (sections.length <= 1 && !sections[0]?.filename) return result;

  for (const section of sections) {
    if (!section.filename) continue;
    const bodyPreview = section.body.slice(0, 500);
    const docType = classifyDocument(section.filename, bodyPreview);
    switch (docType) {
      case 'kss':
        break;
      case 'parameters':
        result.section1.push(section.filename);
        break;
      case 'documentation': {
        if (extractKeyParamsFromDocumentation(section.body)) {
          result.section1.push(section.filename);
          result.section3.push(section.filename);
        }
        break;
      }
      case 'techSpec': {
        if (cleanTechSpec(section.body)) {
          result.section1.push(section.filename);
          result.section2.push(section.filename);
          result.section3.push(section.filename);
        }
        break;
      }
      case 'explanatoryNote': {
        if (cleanExplanatoryNote(section.body)) {
          result.section2.push(section.filename);
        }
        break;
      }
      case 'contract': {
        if (extractGuaranteeFromContract(section.body)) {
          result.section3.push(section.filename);
        }
        break;
      }
      default: {
        if (cleanTechSpec(section.body)) {
          result.section1.push(section.filename);
          result.section2.push(section.filename);
        }
        break;
      }
    }
  }
  return result;
}

/** Split source text by file markers, classify documents, and keep only relevant content */
function cleanSourceText(text: string): string {
  const sections = splitByFileMarkers(text);

  if (sections.length <= 1 && !sections[0]?.filename) {
    return cleanTechSpec(text);
  }

  const outputParts: string[] = [];

  for (const section of sections) {
    const bodyPreview = section.body.slice(0, 500);
    const docType = classifyDocument(section.filename, bodyPreview);

    switch (docType) {
      case 'kss':
        break;

      case 'contract': {
        const guarantee = extractGuaranteeFromContract(section.body);
        if (guarantee) outputParts.push(guarantee);
        break;
      }

      case 'documentation': {
        const params = extractKeyParamsFromDocumentation(section.body);
        if (params) outputParts.push(params);
        break;
      }

      case 'techSpec': {
        const cleaned = cleanTechSpec(section.body);
        if (cleaned) outputParts.push(`[Техническа спецификация]\n${cleaned}`);
        break;
      }

      case 'parameters':
        outputParts.push(`[Параметри на поръчката]\n${section.body.slice(0, 3000)}`);
        break;

      case 'explanatoryNote': {
        const cleaned = cleanExplanatoryNote(section.body);
        if (cleaned) outputParts.push(`[Обяснителна записка]\n${cleaned}`);
        break;
      }

      default: {
        const cleaned = cleanTechSpec(section.body);
        if (cleaned) outputParts.push(cleaned);
        break;
      }
    }
  }

  return outputParts.join('\n\n---\n\n').replace(/\n{4,}/g, '\n\n\n');
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/** Post-process LLM output: strip remaining emails, garbage, KSS data, fix formatting */
function cleanIntroductionOutput(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (EMAIL_REGEX.test(line)) continue;
    if (/@|e-?mail\s*:?/i.test(line)) continue;
    if (isKssTableLine(line)) continue;
    if (/^Всичко:/i.test(line)) continue;
    if (/^\[\s*U\d+\s*\]/i.test(line)) continue;
    if (/^Сметка\s+\d+/i.test(line)) continue;
    if (/^-\s*съгласно\s+(Ведомост|Чертеж)/i.test(line)) continue;
    const noSpace = line.replace(/\s+/g, '');
    const total = noSpace.length;
    if (total >= 10) {
      const alphaNumCount = (noSpace.match(/[A-Za-zА-Яа-яЁё0-9]/g) ?? []).length;
      if (alphaNumCount / total < 0.5) continue;
    }
    line = line.replace(/\s+/g, ' ').trim();
    if (line.length > 1) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
