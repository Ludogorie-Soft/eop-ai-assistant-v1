/**
 * Communication section generation API route
 * Server-side only
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateCommunication } from '@/lib/communicationGenerator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceText, kssNames } = body as {
      sourceText?: string;
      kssNames?: string[];
    };

    if (!sourceText || typeof sourceText !== 'string') {
      return NextResponse.json(
        { error: 'Изходният текст е задължителен' },
        { status: 400 },
      );
    }

    const communication = await generateCommunication(
      sourceText,
      Array.isArray(kssNames) ? kssNames : [],
    );

    return NextResponse.json({ communication });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Грешка при генериране на комуникацията';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
