/**
 * Vector embeddings for offer sections using OpenAI text-embedding-3-small.
 * Stores and searches via Supabase pgvector (cosine similarity).
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

function getEmbeddingsClient(): OpenAIEmbeddings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAIEmbeddings({
    openAIApiKey: apiKey,
    modelName: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMS,
  });
}

function getSupabaseClient() {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const key = (rawKey ?? "").trim().replace(/^["']|["']$/g, "");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  return createClient(url, key);
}

/** Embed a single text string → number[] vector */
export async function embedText(text: string): Promise<number[]> {
  const client = getEmbeddingsClient();
  const vectors = await client.embedDocuments([text.slice(0, 8000)]);
  return vectors[0];
}

/** Embed multiple texts in a single API call (more efficient) */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const client = getEmbeddingsClient();
  return client.embedDocuments(texts.map((t) => t.slice(0, 8000)));
}

export interface SimilarSection {
  id: string;
  offer_id: string;
  section_type: string;
  title: string;
  html_content: string;
  plain_text: string;
  order_index: number;
  similarity: number;
}

/**
 * Search for the most similar offer sections using cosine similarity.
 *
 * @param queryText  The text to search for (will be embedded on-the-fly)
 * @param sectionType  Optional filter: 'introduction' | 'smr_technology' | 'team_organization' | 'communication' | 'other'
 * @param limit  Max results (default 3)
 */
export async function searchSimilarSections(
  queryText: string,
  sectionType?: string,
  limit = 3
): Promise<SimilarSection[]> {
  if (!queryText?.trim()) return [];

  let queryVector: number[];
  try {
    queryVector = await embedText(queryText);
  } catch (err) {
    console.warn("[offerEmbeddings] Embedding failed, skipping RAG context:", err);
    return [];
  }

  const supabase = getSupabaseClient();

  // Use pgvector cosine distance via Supabase RPC
  // We call the match_offer_sections RPC (must be created in Supabase DB)
  const { data, error } = await supabase.rpc("match_offer_sections", {
    query_embedding: queryVector,
    match_section_type: sectionType ?? null,
    match_count: limit,
  });

  if (error) {
    console.warn("[offerEmbeddings] pgvector search failed:", error.message);
    // Fallback: return most recent sections of the requested type
    return fallbackRecentSections(sectionType, limit);
  }

  return (data ?? []) as SimilarSection[];
}

/** Fallback: return most recent sections when vector search isn't available */
async function fallbackRecentSections(
  sectionType?: string,
  limit = 3
): Promise<SimilarSection[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("offer_sections")
    .select("id, offer_id, section_type, title, html_content, plain_text, order_index")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sectionType) {
    query = query.eq("section_type", sectionType);
  }

  const { data } = await query;
  return ((data ?? []) as SimilarSection[]).map((s) => ({
    ...s,
    similarity: 0.5,
  }));
}
