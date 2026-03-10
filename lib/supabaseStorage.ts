/**
 * Supabase Storage client for tender documents
 * Bucket: tender-documents
 * Path: {tenderKey}/{filename}
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'tender-documents';

function getClient(): SupabaseClient {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const key = (rawKey ?? '').trim().replace(/^["']|["']$/g, '');

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required'
    );
  }

  if (!key.startsWith('eyJ')) {
    throw new Error(
      'Invalid Supabase key: must be a JWT starting with eyJ. Copy the full key from Supabase Dashboard → Settings → API.'
    );
  }

  return createClient(url, key);
}

/** Generate storage path from CAIS URL - e.g. "today-558462" */
export function getTenderKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    const id = pathParts[pathParts.length - 1];
    const segment = pathParts[0] ?? 'default';
    return `${segment}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  } catch {
    return `tender-${Date.now()}`;
  }
}

/** Upload buffer to storage */
export async function uploadToStorage(
  tenderKey: string,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const client = getClient();
  const path = `${tenderKey}/${filename}`;

  const { error } = await client.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return path;
}

/** List files in tender folder */
export async function listTenderFiles(tenderKey: string): Promise<{ name: string; path: string }[]> {
  const client = getClient();
  const { data, error } = await client.storage.from(BUCKET).list(tenderKey);

  if (error) {
    if (error.message.includes('not found') || error.message.includes('Bucket')) {
      return [];
    }
    throw new Error(`Supabase list failed: ${error.message}`);
  }

  const files: { name: string; path: string }[] = [];
  for (const item of data ?? []) {
    if (item.name && !item.name.startsWith('.')) {
      const path = `${tenderKey}/${item.name}`;
      files.push({ name: item.name, path });
    }
  }
  return files;
}

/** Download file from storage */
export async function downloadFromStorage(path: string): Promise<Buffer> {
  const client = getClient();
  const { data, error } = await client.storage.from(BUCKET).download(path);

  if (error) throw new Error(`Supabase download failed: ${error.message}`);
  if (!data) throw new Error('Empty response from Supabase');

  return Buffer.from(await data.arrayBuffer());
}
