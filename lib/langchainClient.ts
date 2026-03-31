/**
 * LangChain OpenAI client - server-side only
 * Never expose API key to client
 */

import { ChatOpenAI } from '@langchain/openai';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;

export function createLLM(options?: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  return new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: options?.model ?? DEFAULT_MODEL,
    temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(options?.seed != null && { modelKwargs: { seed: options.seed } }),
  });
}
