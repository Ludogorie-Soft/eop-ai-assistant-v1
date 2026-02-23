/**
 * CAIS fetch API route
 * Uses Puppeteer + Supabase Storage when configured, else fallback to simple fetch
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchCaisContent } from '@/lib/caisFetcher';
import { fetchCaisWithPuppeteerAndStorage } from '@/lib/caisPuppeteer';

const usePuppeteer =
  !!process.env.SUPABASE_URL &&
  !!(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };
    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'CAIS URL is required' },
        { status: 400 }
      );
    }

    console.log('[CAIS] Fetching:', url, usePuppeteer ? '(Puppeteer+Storage)' : '(fetch)');

    const text = usePuppeteer
      ? await fetchCaisWithPuppeteerAndStorage(url)
      : await fetchCaisContent(url);

    console.log('[CAIS] Done, text length:', text?.length ?? 0);
    return NextResponse.json({ text: text ?? '' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch CAIS';
    console.error('[CAIS] Error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
