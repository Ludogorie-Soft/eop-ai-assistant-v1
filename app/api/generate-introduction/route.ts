/**
 * AI Introduction generation API route
 * Server-side only
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateIntroduction } from '@/lib/introductionGenerator';
import { appendVerbatimSections } from '@/lib/verbatimSections';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceText } = body as { sourceText?: string };
    if (!sourceText || typeof sourceText !== 'string') {
      return NextResponse.json(
        { error: 'Source text is required' },
        { status: 400 }
      );
    }

    const introduction = await generateIntroduction(sourceText);
    const withVerbatim = appendVerbatimSections(introduction, sourceText);
    return NextResponse.json({ introduction: withVerbatim });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate introduction';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
