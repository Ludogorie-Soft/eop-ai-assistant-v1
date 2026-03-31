/**
 * Communication section generator.
 * Generates the "Комуникация" section for tender technical proposals.
 * Server-side only.
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createLLM } from './langchainClient';
import { extractRequiredPositions } from './teamPositionExtractor';
import {
  COMMUNICATION_SYSTEM_PROMPT,
  COMMUNICATION_USER_PROMPT_TEMPLATE,
} from './prompts/communicationPrompt';

/**
 * Try to extract the contracting authority name from the raw documentation text.
 * Falls back to generic "Възложителя" if not found.
 */
function extractAuthority(rawText: string): string {
  // "Възложител:" pattern
  const m1 = rawText.match(/[Вв]ъзложител\s*[:\-–]\s*([^\n,]{5,80})/);
  if (m1?.[1]) return m1[1].trim().replace(/\s+/g, ' ');
  // Municipality pattern
  const m2 = rawText.match(/[Оо]бщина\s+([А-Яа-яA-Za-z\s\-]{3,40})/);
  if (m2) return `Община ${m2[1].trim()}`;
  return 'Възложителя';
}

/**
 * Extract a short project subject description (street/object name).
 */
function extractProjectSubject(rawText: string): string {
  const m = rawText.match(/[Пп]редмет\s+на\s+поръчката[:\s]+([^\n]{10,150})/);
  if (m?.[1]) return m[1].trim();
  // Fallback — first line containing "ул." or "бул."
  const streetMatch = rawText.match(/(?:ул\.|бул\.|пл\.)\s+[„"]?([А-Яа-яA-Za-z\s\-„"]+)[„"]?/);
  if (streetMatch?.[0]) return streetMatch[0].trim();
  return 'строително-монтажни работи';
}

/**
 * Group KSS item names by category instead of listing them individually.
 * This produces a cleaner, more structured SMR list for the prompt.
 */
function groupSmrByCategory(kssNames: string[]): string {
  const categories: Record<string, string[]> = {};
  const categoryPatterns: [RegExp, string][] = [
    [/земн|изкоп|насип|транспорт.*земни|натовар/i, 'Земни работи'],
    [/асфалт|битум|фрезов|настилк|плътен|неплътен|основ.*пътн/i, 'Пътни и асфалтови работи'],
    [/тротоар|плоч|павет|пешеход/i, 'Тротоарни работи'],
    [/борд[юи]р/i, 'Бордюри'],
    [/отводн|канал|шахт|дъждоприемн|решетк|тръб.*канал/i, 'Отводняване и канализация'],
    [/сигнализ|маркировк|знак|пътен.*знак|хоризонтал.*маркир|вертикал.*сигнал/i, 'Сигнализация и маркировка'],
    [/озелен|дърв|храст|трев|засаждан/i, 'Озеленяване'],
    [/демонтаж|разруш|събар/i, 'Демонтажни работи'],
    [/бетон|кофраж|арматур/i, 'Бетонови работи'],
    [/електр|осветл|кабел|стълб.*осветл/i, 'Електрически работи и осветление'],
  ];

  for (const name of kssNames) {
    let matched = false;
    for (const [pattern, category] of categoryPatterns) {
      if (pattern.test(name)) {
        if (!categories[category]) categories[category] = [];
        categories[category].push(name);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!categories['Други СМР']) categories['Други СМР'] = [];
      categories['Други СМР'].push(name);
    }
  }

  return Object.entries(categories)
    .map(([cat, items], i) => `${i + 1}. ${cat} (${items.slice(0, 5).join(', ')}${items.length > 5 ? ' и др.' : ''})`)
    .join('\n');
}

/**
 * Generate the full Communication section as HTML.
 *
 * @param rawText - Full text from uploaded tender documentation
 * @param kssNames - KSS item names for the SMR responsibility breakdown
 */
export async function generateCommunication(
  rawText: string,
  kssNames: string[] = [],
): Promise<string> {
  const positions = extractRequiredPositions(rawText);

  // Always include Геодезия if not already present
  const expertNames = positions.map((p) => p.name);
  const hasGeodesy = expertNames.some((n) => /геодез/i.test(n));
  // Always prepend Ръководител на проекта as first member (matching reference document structure)
  const hasProjectManager = expertNames.some((n) => /ръководител\s+на\s+проекта/i.test(n));
  const finalExperts: string[] = [];
  if (!hasProjectManager) finalExperts.push('Ръководител на проекта');
  finalExperts.push(...expertNames);
  if (!hasGeodesy) finalExperts.push('Експерт по част „Геодезия"');

  const authority = extractAuthority(rawText);
  const projectSubject = extractProjectSubject(rawText);

  const expertsList = finalExperts.length
    ? finalExperts.map((e, i) => `${i + 1}. ${e}`).join('\n')
    : '1. Технически ръководител\n2. Специалист по контрол на качеството\n3. Експерт по безопасност и здраве\n4. Експерт по част „Геодезия"';

  const smrList = kssNames.length
    ? groupSmrByCategory(kssNames)
    : '(няма данни от КСС)';

  const llm = createLLM({ temperature: 0.2, maxTokens: 16384 });
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', COMMUNICATION_SYSTEM_PROMPT],
    ['human', COMMUNICATION_USER_PROMPT_TEMPLATE],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    projectSubject,
    authority,
    expertsList,
    smrList,
  });

  const content = typeof response.content === 'string' ? response.content : '';
  return content.trim();
}
