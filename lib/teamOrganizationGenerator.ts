/**
 * Team Organization generator: matches required positions from documentation
 * to template positions, then paraphrases each via LLM.
 * Server-side only.
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createLLM } from './langchainClient';
import { extractRequiredPositions, type RequiredPosition } from './teamPositionExtractor';
import { parseTeamTemplateDocx, type TeamPosition } from './teamTemplateParser';
import {
  TEAM_MATCHER_SYSTEM_PROMPT,
  TEAM_MATCHER_USER_PROMPT_TEMPLATE,
  TEAM_REVERSE_MATCHER_SYSTEM_PROMPT,
  TEAM_REVERSE_MATCHER_USER_PROMPT_TEMPLATE,
  TEAM_PARAPHRASER_SYSTEM_PROMPT,
  TEAM_PARAPHRASER_USER_PROMPT_TEMPLATE,
} from './prompts/teamPrompt';

interface PositionMatch {
  docPosition: string;
  matchedTemplate: string;
  confidence: number;
}

interface ReverseMatch {
  templateTitle: string;
  matchedDocPosition: string;
  confidence: number;
}

export interface TeamOrganizationResult {
  positionName: string;
  requirements: string;
  templateTitle: string | null;
  text: string;
  confidence: number;
}

function parseMatcherJson(content: string): PositionMatch[] {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        docPosition: String(item.docPosition ?? ''),
        matchedTemplate: String(item.matchedTemplate ?? 'NONE'),
        confidence: typeof item.confidence === 'number' ? item.confidence : 0,
      }));
  } catch {
    return [];
  }
}

async function matchPositions(
  docPositions: RequiredPosition[],
  templatePositions: TeamPosition[],
): Promise<PositionMatch[]> {
  const llm = createLLM({ temperature: 0, maxTokens: 2048 });
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', TEAM_MATCHER_SYSTEM_PROMPT],
    ['human', TEAM_MATCHER_USER_PROMPT_TEMPLATE],
  ]);

  const docList = docPositions
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join('\n');
  const templateList = templatePositions
    .map((p, i) => `${i + 1}. ${p.title}`)
    .join('\n');

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    docPositions: docList,
    templatePositions: templateList,
  });

  const content = typeof response.content === 'string' ? response.content : '';
  return parseMatcherJson(content);
}

function parseReverseMatcherJson(content: string): ReverseMatch[] {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        templateTitle: String(item.templateTitle ?? ''),
        matchedDocPosition: String(item.matchedDocPosition ?? 'NONE'),
        confidence: typeof item.confidence === 'number' ? item.confidence : 0,
      }));
  } catch {
    return [];
  }
}

/** For each template position, find the closest doc position (to use its requirements for paraphrasing) */
async function matchTemplateToDoc(
  templatePositions: TeamPosition[],
  docPositions: RequiredPosition[],
): Promise<ReverseMatch[]> {
  const llm = createLLM({ temperature: 0, maxTokens: 2048 });
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', TEAM_REVERSE_MATCHER_SYSTEM_PROMPT],
    ['human', TEAM_REVERSE_MATCHER_USER_PROMPT_TEMPLATE],
  ]);

  const templateList = templatePositions
    .map((p, i) => `${i + 1}. ${p.title}`)
    .join('\n');
  const docListWithReqs = docPositions
    .map((p, i) => `${i + 1}. ${p.name}\n   Изисквания: ${(p.requirements || '').slice(0, 200).trim() || '-'}`)
    .join('\n\n');

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    templatePositions: templateList,
    docPositionsWithRequirements: docListWithReqs,
  });

  const content = typeof response.content === 'string' ? response.content : '';
  return parseReverseMatcherJson(content);
}

async function paraphrasePosition(
  positionName: string,
  requirements: string,
  templateBody: string,
  kssContext: string,
): Promise<string> {
  const llm = createLLM({ temperature: 0.2, maxTokens: 16384 });
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', TEAM_PARAPHRASER_SYSTEM_PROMPT],
    ['human', TEAM_PARAPHRASER_USER_PROMPT_TEMPLATE],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    positionName,
    requirements: requirements || '[Не са посочени специфични изисквания в документацията]',
    templateBody: templateBody.slice(0, 60000),
    kssContext: kssContext
      ? `Контекст от КСС (видове работи по проекта):\n${kssContext}`
      : '',
  });

  const content = typeof response.content === 'string' ? response.content : '';
  return content
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/🔹/g, '')
    .trim();
}

/**
 * Generate team organization text.
 * @param rawText - Full raw text from uploaded documents
 * @param templateBuffer - Team template DOCX buffer
 * @param kssNames - Optional array of KSS item names for context
 */
export async function generateTeamOrganization(
  rawText: string,
  templateBuffer: Buffer,
  kssNames?: string[],
): Promise<string> {
  const docPositions = extractRequiredPositions(rawText);
  if (docPositions.length === 0) {
    throw new Error(
      'Не са намерени изисквания за персонал в документацията. Проверете дали сте качили "Документация за участие".'
    );
  }

  const templatePositions = await parseTeamTemplateDocx(templateBuffer);
  if (templatePositions.length === 0) {
    throw new Error(
      'Не са намерени длъжности в шаблона. Проверете формата на файла.'
    );
  }

  const [matches, reverseMatches] = await Promise.all([
    matchPositions(docPositions, templatePositions),
    matchTemplateToDoc(templatePositions, docPositions),
  ]);

  const kssContext = kssNames?.length
    ? kssNames.slice(0, 100).join(', ')
    : '';

  const results: TeamOrganizationResult[] = [];
  const usedTemplateTitles = new Set<string>();

  // 1) Първо – длъжностите, изискани от документацията (в реда на документацията).
  // Винаги използваме най-близкия шаблон – дори при по-ниска увереност.
  const primaryResults = await Promise.all(
    docPositions.map(async (docPos) => {
      const match = matches.find(
        (m) => m.docPosition.toLowerCase() === docPos.name.toLowerCase()
      );

      const templatePos =
        match && match.matchedTemplate !== 'NONE'
          ? templatePositions.find(
              (t) => t.title.toLowerCase() === match.matchedTemplate.toLowerCase()
            )
          : null;

      if (!templatePos) return null;

      const text = await paraphrasePosition(
        docPos.name,
        docPos.requirements,
        templatePos.body,
        kssContext,
      );

      usedTemplateTitles.add(templatePos.title.toLowerCase());

      return {
        positionName: docPos.name,
        requirements: docPos.requirements,
        templateTitle: templatePos.title,
        text,
        confidence: match!.confidence,
      } satisfies TeamOrganizationResult;
    })
  );

  for (const res of primaryResults) {
    if (res) results.push(res);
  }

  // 2) После – всички останали длъжности от шаблона. За всяка намираме най-близката
  // длъжност от документацията и използваме нейните изисквания (не празни).
  const secondaryResults = await Promise.all(
    templatePositions.map(async (tpl) => {
      if (usedTemplateTitles.has(tpl.title.toLowerCase())) return null;

      const revMatch = reverseMatches.find(
        (m) => m.templateTitle.toLowerCase() === tpl.title.toLowerCase()
      );
      const docPos =
        revMatch &&
        revMatch.matchedDocPosition !== 'NONE'
          ? docPositions.find(
              (d) =>
                d.name.toLowerCase() === revMatch.matchedDocPosition.toLowerCase()
            )
          : null;

      const requirements = docPos?.requirements ?? '';

      const text = await paraphrasePosition(
        tpl.title,
        requirements,
        tpl.body,
        kssContext,
      );

      return {
        positionName: tpl.title,
        requirements,
        templateTitle: tpl.title,
        text,
        confidence: revMatch?.confidence ?? 0,
      } satisfies TeamOrganizationResult;
    })
  );

  for (const res of secondaryResults) {
    if (res) results.push(res);
  }

  return formatOutput(results);
}

function formatOutput(results: TeamOrganizationResult[]): string {
  return results
    .map((r) => r.text)
    .join('\n\n' + '─'.repeat(50) + '\n\n');
}

