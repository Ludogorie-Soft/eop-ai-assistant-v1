/**
 * LLM-based SMR matcher: compares KSS position name to SMR template titles.
 * Returns matched body text and confidence; if confidence < 75 returns "[не е намерен]".
 * Server-side only. Deterministic (temperature 0, fixed seed).
 *
 * Pre-filters templates by keyword overlap to keep the LLM prompt short and
 * focused — this dramatically improves both accuracy and consistency when the
 * template pool is large (300+ titles).
 */

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createLLM } from "./langchainClient";
import type { SmrTemplate } from "./smrTemplateParser";
import {
  SMR_MATCHER_SYSTEM_PROMPT,
  SMR_MATCHER_USER_PROMPT_TEMPLATE,
} from "./prompts/smrMatcherPrompt";

export type MatchResult = {
  text: string;
  confidence: number;
  matchedTitle: string | null;
  htmlBody?: string;
};

type LlmMatch = {
  matchedTitle: string;
  confidence: number;
  reasoning: string;
};

/* ------------------------------------------------------------------ */
/*  Keyword-based pre-filter                                          */
/* ------------------------------------------------------------------ */

/** Bulgarian stop-words / noise tokens to ignore during keyword scoring. */
const STOP_WORDS = new Set([
  "и", "на", "в", "с", "за", "от", "до", "по", "при", "към",
  "се", "е", "да", "не", "ще", "а", "или", "но", "че", "като",
  "ли", "бъде", "със", "без", "след", "преди", "между", "над", "под",
  "включително", "всички", "свързани", "това", "разходи", "съгласно",
  "изискванията", "определено", "растояние", "разстояние",
  "включителн", "вкл", "вс", "дейности", "работи",
  "тс", "тех", "техническата", "техническите", "спецификация",
  "доставка", "монтаж", "направа", "изпълнение",
]);

/**
 * Tokenize a Bulgarian construction text into meaningful keywords.
 * Returns lowercased tokens with length ≥ 2, excluding stop-words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,;:!?""\"'–—\-()\/\\[\]{}]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Score a template title against a KSS name by keyword overlap.
 * Uses Jaccard-like similarity + bonus for bigram matches.
 */
function keywordScore(kssTokens: string[], titleTokens: string[]): number {
  if (kssTokens.length === 0 || titleTokens.length === 0) return 0;

  const titleSet = new Set(titleTokens);
  let matchCount = 0;
  for (const t of kssTokens) {
    if (titleSet.has(t)) {
      matchCount++;
    } else {
      // Partial / substring match (e.g. "бордюри" vs "бордюр")
      for (const tt of titleSet) {
        if (tt.length >= 4 && t.length >= 4 && (tt.startsWith(t.slice(0, 4)) || t.startsWith(tt.slice(0, 4)))) {
          matchCount += 0.7;
          break;
        }
      }
    }
  }

  // Jaccard-style: matched / union
  const union = new Set([...kssTokens, ...titleTokens]).size;
  const jaccard = matchCount / union;

  // Bigram bonus: consecutive word pairs matching adds extra signal
  let bigramBonus = 0;
  for (let i = 0; i < kssTokens.length - 1; i++) {
    const bigram = kssTokens[i] + " " + kssTokens[i + 1];
    for (let j = 0; j < titleTokens.length - 1; j++) {
      const tBigram = titleTokens[j] + " " + titleTokens[j + 1];
      if (bigram === tBigram) {
        bigramBonus += 0.15;
        break;
      }
    }
  }

  return jaccard + bigramBonus;
}

/** Maximum number of candidate templates to send to the LLM. */
const MAX_CANDIDATES = 20;

/**
 * Pre-filter templates by keyword overlap, returning the top candidates.
 * If the pool is already small enough, returns all templates unchanged.
 */
function preFilterTemplates(
  kssName: string,
  smrTemplates: SmrTemplate[],
): SmrTemplate[] {
  if (smrTemplates.length <= MAX_CANDIDATES) return smrTemplates;

  const kssTokens = tokenize(kssName);
  if (kssTokens.length === 0) return smrTemplates.slice(0, MAX_CANDIDATES);

  const scored = smrTemplates.map((t) => ({
    template: t,
    score: keywordScore(kssTokens, tokenize(t.title)),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Always include at least MAX_CANDIDATES, but also pull in any ties at the cutoff
  const cutoff = scored[MAX_CANDIDATES - 1]?.score ?? 0;
  const candidates = scored.filter(
    (s, i) => i < MAX_CANDIDATES || s.score >= cutoff,
  );

  return candidates.map((s) => s.template);
}

/* ------------------------------------------------------------------ */

function parseLlmJson(content: string): LlmMatch | null {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const matchedTitle =
      typeof parsed.matchedTitle === "string" ? parsed.matchedTitle : "";
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(100, Math.max(0, parsed.confidence))
        : 0;
    return {
      matchedTitle,
      confidence,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Find best matching SMR template for a single KSS position name.
 * If confidence < 75 or matchedTitle is "NONE", returns text "[не е намерен]";
 * otherwise returns the body of the matched template.
 */
export async function matchKssToSmr(
  kssName: string,
  smrTemplates: SmrTemplate[],
): Promise<MatchResult> {
  if (typeof kssName !== 'string' || !kssName.trim()) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }
  if (smrTemplates.length === 0) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  // Pre-filter to top candidates so the LLM prompt stays short & focused
  const candidates = preFilterTemplates(kssName, smrTemplates);

  const titles = candidates.map((t) => t.title);
  const smrTitlesList = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const llm = createLLM({
    temperature: 0,
    maxTokens: 512,
    seed: 42,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SMR_MATCHER_SYSTEM_PROMPT],
    ["human", SMR_MATCHER_USER_PROMPT_TEMPLATE],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    kssName: kssName.trim(),
    smrTitlesList,
  });

  const content = response.content;
  const raw = typeof content === "string" ? content : "";
  const parsed = parseLlmJson(raw);

  if (!parsed) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  const confidence = parsed.confidence;
  const isNoneMatch =
    parsed.matchedTitle.trim().toUpperCase() === "NONE" ||
    parsed.matchedTitle.trim() === "";

  // Reject if LLM returned NONE or confidence is below threshold
  if (isNoneMatch || confidence < 75) {
    return {
      text: "[не е намерен]",
      confidence: 0,
      matchedTitle: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Deterministic post-match guards — override LLM when known false positives occur
  // ---------------------------------------------------------------------------
  const kssLower = kssName.toLowerCase();
  const matchedLower = parsed.matchedTitle.toLowerCase();

  // "Технологично фрезоване с цел осигуряване на минимални технологични дебелини"
  // must NEVER match any "Отстраняване (фрезоване)" template.
  // The LLM confuses them because both mention "фрезоване", but they are opposite
  // operations (creating space for NEW layers vs. removing OLD ones).
  if (
    kssLower.includes("технологич") &&
    kssLower.includes("дебелин") &&
    matchedLower.includes("отстраняв")
  ) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  // "Разваляне на пътна основа / пътно покритие, включително изкопаване, натоварване..."
  // is road-base earthwork demolition — must NOT match asphalt surface templates.
  if (
    kssLower.includes("разваляне") &&
    (kssLower.includes("пътна основа") || kssLower.includes("пътно покритие")) &&
    (matchedLower.includes("асфалтобетон") || matchedLower.includes("настилка") ||
      matchedLower.includes("фрезоване"))
  ) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  // N2W containment level cross-matching: N2W3 ≠ N2W5 ≠ N2W4.
  // Extract the barrier class from KSS name and matched title; reject if they differ.
  const kssBarrier = kssLower.match(/n\s*(\d+)\s*w\s*(\d+)/i);
  const matchedBarrier = matchedLower.match(/n\s*(\d+)\s*w\s*(\d+)/i);
  if (kssBarrier && matchedBarrier && kssBarrier[0].replace(/\s/g,'') !== matchedBarrier[0].replace(/\s/g,'')) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  // "Линейни отводнители" (channel drains) must NOT match "шахта" templates (point drains).
  if (kssLower.includes("линейни отводнители") && matchedLower.includes("шахт")) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  // "Ел. шахта" / "електро шахта" must NOT match a pure "ревизионна шахта" template
  // (i.e. one that says "ревизионн" but does NOT also say "ел." / "електр").
  {
    const isKssElShahta =
      kssLower.includes("ел. шахт") || kssLower.includes("ел.шахт") ||
      kssLower.includes("електро шахт") ||
      (kssLower.includes("електрическ") && kssLower.includes("шахт"));
    const isMatchedPureRevision =
      matchedLower.includes("ревизионн") &&
      !matchedLower.includes("ел.") && !matchedLower.includes("ел ") &&
      !matchedLower.includes("електр");
    if (isKssElShahta && isMatchedPureRevision) {
      return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
    }
  }

  // "Изкореняване" in urban context must NOT match rural road right-of-way clearance templates.
  if (
    kssLower.includes("изкореняване") &&
    (matchedLower.includes("сервитут") || matchedLower.includes("разчистване на площ"))
  ) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  // "Втори битумен разлив" must NOT match a template for "Първи битумен разлив".
  if (
    kssLower.includes("втори") && kssLower.includes("битумен") && kssLower.includes("разлив") &&
    matchedLower.includes("първи") && matchedLower.includes("битумен")
  ) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  const normalizeTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const template = smrTemplates.find(
    (t) => normalizeTitle(t.title) === normalizeTitle(parsed.matchedTitle),
  );

  if (!template) {
    return { text: "[не е намерен]", confidence: 0, matchedTitle: null };
  }

  return {
    text: template.body,
    confidence,
    matchedTitle: template.title,
    htmlBody: template.htmlBody,
  };
}
