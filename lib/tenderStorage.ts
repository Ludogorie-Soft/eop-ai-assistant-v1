/**
 * Supabase client for tenders CRUD.
 * Table: tenders
 */

import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const key = (rawKey ?? '').trim().replace(/^["']|["']$/g, '');

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required'
    );
  }

  return createClient(url, key);
}

export interface TenderRow {
  id: string;
  name: string;
  introduction_text: string;
  raw_text: string;
  smr_results: unknown[];
  created_at: string;
  updated_at: string;
}

export interface TenderSummary {
  id: string;
  name: string;
  hasIntroduction: boolean;
  smrCount: number;
  createdAt: string;
  updatedAt: string;
}

function toSummary(row: TenderRow): TenderSummary {
  return {
    id: row.id,
    name: row.name,
    hasIntroduction: Boolean(row.introduction_text?.trim()),
    smrCount: Array.isArray(row.smr_results) ? row.smr_results.length : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTenders(): Promise<TenderSummary[]> {
  const client = getClient();
  const { data, error } = await client
    .from('tenders')
    .select('id, name, introduction_text, smr_results, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`List tenders failed: ${error.message}`);
  return (data ?? []).map((r) => toSummary(r as TenderRow));
}

export async function createTender(name: string): Promise<TenderRow> {
  const client = getClient();
  const { data, error } = await client
    .from('tenders')
    .insert({ name })
    .select()
    .single();

  if (error) throw new Error(`Create tender failed: ${error.message}`);
  return data as TenderRow;
}

export async function getTender(id: string): Promise<TenderRow | null> {
  const client = getClient();
  const { data, error } = await client
    .from('tenders')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Get tender failed: ${error.message}`);
  }
  return data as TenderRow;
}

export async function updateTender(
  id: string,
  fields: Partial<Pick<TenderRow, 'name' | 'introduction_text' | 'raw_text' | 'smr_results'>>
): Promise<TenderRow> {
  const client = getClient();
  const { data, error } = await client
    .from('tenders')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Update tender failed: ${error.message}`);
  return data as TenderRow;
}

export async function deleteTender(id: string): Promise<void> {
  const client = getClient();
  const { error } = await client.from('tenders').delete().eq('id', id);
  if (error) throw new Error(`Delete tender failed: ${error.message}`);
}
