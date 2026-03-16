/**
 * KSS → SMR text generator: for each KSS item, find best SMR template and return aggregated results.
 * Orchestrates kssParser, smrTemplateParser, smrMatcher. Server-side only.
 *
 * Rate-limit handling:
 *  - Items are processed with limited concurrency (MAX_CONCURRENT) to avoid TPM spikes.
 *  - On 429 rate-limit errors the call is retried with exponential back-off (up to MAX_RETRIES).
 */

import type { KssItem } from './kssParser';
import type { SmrTemplate } from './smrTemplateParser';
import { matchKssToSmr, type MatchResult } from './smrMatcher';

export type SmrResult = {
  kssCode: string;
  kssName: string;
  matchedTitle: string | null;
  text: string;
  confidence: number;
  htmlBody?: string;
};

/** Max simultaneous LLM calls — keeps us well under the 200K TPM limit. */
const MAX_CONCURRENT = 5;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 6_000; // first wait ~6 s, then 12 s, 24 s, 48 s

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || msg.toLowerCase().includes('rate limit');
}

async function matchWithRetry(
  kssName: string,
  smrTemplates: SmrTemplate[],
): Promise<MatchResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await matchKssToSmr(kssName, smrTemplates);
    } catch (err) {
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const waitMs = RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(
          `[kssSmrGenerator] Rate limit hit for "${kssName}", retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await new Promise((res) => setTimeout(res, waitMs));
      } else {
        throw err;
      }
    }
  }
  // Unreachable — loop above always returns or throws
  return { text: '[не е намерен]', confidence: 0, matchedTitle: null };
}

/**
 * Run an async mapper over an array with at most `concurrency` simultaneous calls.
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * For each KSS item, match to best SMR template via LLM and apply confidence rule.
 * Returns one SmrResult per KssItem.
 * Items are processed with bounded concurrency and auto-retry on rate-limit errors.
 */
export async function generateSmrTextsForKss(
  kssItems: KssItem[],
  smrTemplates: SmrTemplate[]
): Promise<SmrResult[]> {
  return mapConcurrent(kssItems, MAX_CONCURRENT, async (item) => {
    const match = await matchWithRetry(item.name, smrTemplates);
    return {
      kssCode: item.code,
      kssName: item.name,
      matchedTitle: match.matchedTitle,
      text: match.text,
      confidence: match.confidence,
      htmlBody: match.htmlBody,
    };
  });
}
