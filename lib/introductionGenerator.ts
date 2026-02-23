/**
 * AI-powered Introduction generator using LangChain
 * Server-side only
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createLLM } from './langchainClient';
import {
  INTRODUCTION_SYSTEM_PROMPT,
  INTRODUCTION_USER_PROMPT_TEMPLATE,
} from './prompts/introductionPrompt';

export async function generateIntroduction(sourceText: string): Promise<string> {
  if (!sourceText?.trim()) {
    throw new Error('Source text is required for introduction generation');
  }

  const llm = createLLM({
    temperature: 0.2,
    maxTokens: 4096,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', INTRODUCTION_SYSTEM_PROMPT],
    ['human', INTRODUCTION_USER_PROMPT_TEMPLATE],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({
    sourceText: sourceText.slice(0, 100000), // Limit context size
  });

  const content = response.content;
  if (typeof content !== 'string') {
    throw new Error('Unexpected response format from LLM');
  }

  return stripMarkdownBold(content.trim());
}

function stripMarkdownBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}
