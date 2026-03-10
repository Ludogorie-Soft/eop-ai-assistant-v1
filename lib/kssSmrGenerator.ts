/**
 * KSS → SMR text generator: for each KSS item, find best SMR template and return aggregated results.
 * Orchestrates kssParser, smrTemplateParser, smrMatcher. Server-side only.
 */

import type { KssItem } from './kssParser';
import type { SmrTemplate } from './smrTemplateParser';
import { matchKssToSmr } from './smrMatcher';

export type SmrResult = {
  kssCode: string;
  kssName: string;
  matchedTitle: string | null;
  text: string;
  confidence: number;
  htmlBody?: string;
};

/**
 * For each KSS item, match to best SMR template via LLM and apply confidence rule.
 * Returns one SmrResult per KssItem.
 */
export async function generateSmrTextsForKss(
  kssItems: KssItem[],
  smrTemplates: SmrTemplate[]
): Promise<SmrResult[]> {
  return Promise.all(
    kssItems.map(async (item) => {
      const match = await matchKssToSmr(item.name, smrTemplates);
      return {
        kssCode: item.code,
        kssName: item.name,
        matchedTitle: match.matchedTitle,
        text: match.text,
        confidence: match.confidence,
        htmlBody: match.htmlBody,
      };
    }),
  );
}
