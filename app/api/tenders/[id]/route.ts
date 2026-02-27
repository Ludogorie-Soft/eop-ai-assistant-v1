/**
 * Single tender API.
 * GET    - fetch tender by id
 * PUT    - update tender fields (name, introduction_text, team_organization_text, raw_text, smr_results)
 * DELETE - delete tender
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTender, updateTender, deleteTender } from '@/lib/tenderStorage';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const tender = await getTender(id);
    if (!tender) {
      return NextResponse.json({ error: 'Поръчката не е намерена.' }, { status: 404 });
    }
    return NextResponse.json({ tender });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get tender';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;

    const fields: Record<string, unknown> = {};
    if (typeof body.name === 'string') fields.name = body.name;
    if (typeof body.introduction_text === 'string') fields.introduction_text = body.introduction_text;
    if (typeof body.raw_text === 'string') fields.raw_text = body.raw_text;
    if (typeof body.team_organization_text === 'string')
      fields.team_organization_text = body.team_organization_text;
    if (Array.isArray(body.smr_results)) fields.smr_results = body.smr_results;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Няма данни за обновяване.' }, { status: 400 });
    }

    const tender = await updateTender(id, fields);
    return NextResponse.json({ tender });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tender';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteTender(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete tender';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
