/**
 * Team Organization generation API route
 * Server-side only
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateTeamOrganization } from '@/lib/teamOrganizationGenerator';
import { downloadLatestTeamTemplate } from '@/lib/teamTemplateStorage';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceText, kssNames } = body as { sourceText?: string; kssNames?: string[] };
    if (!sourceText || typeof sourceText !== 'string') {
      return NextResponse.json(
        { error: 'Source text is required' },
        { status: 400 }
      );
    }

    const templateBuffer = await downloadLatestTeamTemplate();
    if (!templateBuffer) {
      return NextResponse.json(
        { error: 'Няма качен шаблон за длъжности. Качете шаблон от секцията „Шаблони\".' },
        { status: 400 }
      );
    }

    const teamOrganization = await generateTeamOrganization(
      sourceText,
      templateBuffer,
      Array.isArray(kssNames) ? kssNames : undefined,
    );

    return NextResponse.json({ teamOrganization });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate team organization';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

