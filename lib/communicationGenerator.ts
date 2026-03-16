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
  const hasGeodesy = expertNames.some((n) =>
    /геодез/i.test(n)
  );
  const finalExperts = [...expertNames];
  if (!hasGeodesy) finalExperts.push('Експерт по част „Геодезия"');

  const authority = extractAuthority(rawText);
  const projectSubject = extractProjectSubject(rawText);

  const expertsList = finalExperts.length
    ? finalExperts.map((e, i) => `${i + 1}. ${e}`).join('\n')
    : '1. Технически ръководител\n2. Специалист по контрол на качеството\n3. Експерт по безопасност и здраве\n4. Експерт по част „Геодезия"';

  const smrList = kssNames.length
    ? kssNames.slice(0, 30).map((n, i) => `${i + 1}. ${n}`).join('\n')
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
