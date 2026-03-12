/**
 * Tenders API.
 * GET  - list all tenders (summary)
 * POST - create a new tender { name: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { listTenders, createTender } from '@/lib/tenderStorage';

export async function GET() {
  try {
    const tenders = await listTenders();
    return NextResponse.json({ tenders });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Грешка при зареждане на поръчките';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim() || 'Нова поръчка';
    const tender = await createTender(name);
    return NextResponse.json({ tender }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Грешка при създаване на поръчката';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
