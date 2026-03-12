/**
 * LLM-based SMR matcher: compares KSS position name to SMR template titles.
 * Returns matched body text and confidence; if confidence < 60 returns "[не е намерен]".
 * Server-side only. Deterministic (temperature 0).
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

  const titles = smrTemplates.map((t) => t.title);
  const smrTitlesList = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const llm = createLLM({
    temperature: 0,
    maxTokens: 512,
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

  const template = smrTemplates.find(
    (t) =>
      t.title.trim().toLowerCase() === parsed.matchedTitle.trim().toLowerCase(),
  );

  const body = template?.body ?? "[не е намерен]";
  return {
    text: body,
    confidence,
    matchedTitle: template ? template.title : parsed.matchedTitle || null,
    htmlBody: template?.htmlBody,
  };
}
