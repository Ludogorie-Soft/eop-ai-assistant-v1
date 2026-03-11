/**
 * Cache layer for standards validation results.
 * Uses Supabase if configured, falls back to in-memory Map.
 * Server-side only.
 */

import type { ValidationResult } from "./standardsValidator";

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------
let memoryCache: Map<string, ValidationResult> = new Map();

// ---------------------------------------------------------------------------
// Supabase persistence (optional)
// ---------------------------------------------------------------------------

function getSupabaseClient() {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const key = (rawKey ?? "").trim().replace(/^["']|["']$/g, "");
  if (!url || !key) return null;

  // Dynamic import to avoid errors when Supabase is not configured
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require("@supabase/supabase-js");
    return createClient(url, key);
  } catch {
    return null;
  }
}

/**
 * Load all cached validation results.
 * Tries Supabase first, falls back to in-memory.
 */
export async function loadCache(): Promise<Map<string, ValidationResult>> {
  const client = getSupabaseClient();
  if (!client) return new Map(memoryCache);

  try {
    const { data, error } = await client
      .from("standards_cache")
      .select("reference_key, ref_type, status, status_code, current_title, replacement, note, source, checked_at");

    if (error) {
      console.warn("[standardsCache] DB load failed:", error.message);
      return new Map(memoryCache);
    }

    const cache = new Map<string, ValidationResult>();
    for (const row of data ?? []) {
      cache.set(row.reference_key, {
        reference: row.reference_key,
        status: row.status,
        statusCode: row.status_code ?? undefined,
        currentTitle: row.current_title ?? undefined,
        replacement: row.replacement ?? undefined,
        note: row.note ?? undefined,
        lastChecked: row.checked_at,
        source: row.source,
      });
    }

    // Update memory cache
    memoryCache = new Map(cache);
    return cache;
  } catch (err) {
    console.warn("[standardsCache] DB load error:", err);
    return new Map(memoryCache);
  }
}

/**
 * Clear all cached validation results (both in-memory and Supabase).
 */
export async function clearCache(): Promise<void> {
  memoryCache = new Map();

  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client
      .from("standards_cache")
      .delete()
      .neq("reference_key", ""); // delete all rows

    if (error) {
      console.warn("[standardsCache] DB clear failed:", error.message);
    } else {
      console.log("[standardsCache] Cache cleared.");
    }
  } catch (err) {
    console.warn("[standardsCache] DB clear error:", err);
  }
}

/**
 * Save validation results to cache.
 * Upserts to Supabase if available, always updates in-memory.
 */
export async function saveCache(
  results: Map<string, ValidationResult>
): Promise<void> {
  // Always update in-memory
  memoryCache = new Map(results);

  const client = getSupabaseClient();
  if (!client) return;

  try {
    const rows = [...results.entries()].map(([key, r]) => ({
      reference_key: key,
      ref_type: key.match(/^(Наредба|Закон)/i) ? "regulation" : "standard",
      status: r.status,
      status_code: r.statusCode ?? null,
      current_title: r.currentTitle ?? null,
      replacement: r.replacement ?? null,
      note: r.note ?? null,
      source: r.source,
      checked_at: r.lastChecked,
    }));

    const { error } = await client
      .from("standards_cache")
      .upsert(rows, { onConflict: "reference_key" });

    if (error) {
      console.warn("[standardsCache] DB save failed:", error.message);
    }
  } catch (err) {
    console.warn("[standardsCache] DB save error:", err);
  }
}
