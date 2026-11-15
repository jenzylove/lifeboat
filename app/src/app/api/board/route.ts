import { NextResponse } from 'next/server';
import { getBoard } from '@/lib/server/board';
import { redact } from '@/lib/server/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(await getBoard());
  } catch (e) {
    return NextResponse.json({ error: redact(e) }, { status: 502 });
  }
}
