/**
 * Supabase Storage client for team position templates
 * Bucket: team-templates
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'team-templates';

const CYR_TO_LAT: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ж: 'Zh', З: 'Z',
  И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P',
  Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'H', Ц: 'Ts', Ч: 'Ch',
  Ш: 'Sh', Щ: 'Sht', Ъ: 'A', Ь: 'Y', Ю: 'Yu', Я: 'Ya',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

function transliterate(text: string): string {
  return text.replace(/./g, (ch) => CYR_TO_LAT[ch] ?? ch);
}

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

  return createClient(url, key);
}

export interface TeamTemplateInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export async function uploadTeamTemplate(
  filename: string,
  buffer: Buffer
): Promise<TeamTemplateInfo> {
  const client = getClient();
  const date = new Date().toISOString().slice(0, 10);
  const latinName = transliterate(filename);
  const safeName = latinName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${date}_${safeName}`;

  const { error } = await client.storage.from(BUCKET).upload(path, buffer, {
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: false,
  });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  return {
    name: filename,
    path,
    size: buffer.length,
    createdAt: new Date().toISOString(),
  };
}

export async function listTeamTemplates(): Promise<TeamTemplateInfo[]> {
  const client = getClient();
  const { data, error } = await client.storage.from(BUCKET).list('', {
    sortBy: { column: 'created_at', order: 'desc' },
  });

  if (error) {
    if (
      error.message.includes('not found') ||
      error.message.includes('Bucket')
    ) {
      return [];
    }
    throw new Error(`List failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => ({
      name: f.name,
      path: f.name,
      size: f.metadata?.size ?? 0,
      createdAt: f.created_at ?? '',
    }));
}

export async function downloadLatestTeamTemplate(): Promise<Buffer | null> {
  const templates = await listTeamTemplates();
  if (templates.length === 0) return null;
  return downloadTeamTemplate(templates[0].path);
}

export async function downloadTeamTemplate(path: string): Promise<Buffer> {
  const client = getClient();
  const { data, error } = await client.storage.from(BUCKET).download(path);

  if (error) throw new Error(`Download failed: ${error.message}`);
  if (!data) throw new Error('Empty response from Supabase');

  return Buffer.from(await data.arrayBuffer());
}

export async function deleteTeamTemplate(path: string): Promise<void> {
  const client = getClient();
  const { error } = await client.storage.from(BUCKET).remove([path]);

  if (error) throw new Error(`Delete failed: ${error.message}`);
}

