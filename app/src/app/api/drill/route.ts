import { NextResponse } from 'next/server';
import { houseAccount } from '@/lib/server/config';
import { fireDrill } from '@/lib/server/drill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const account = houseAccount();
  if (!account) return NextResponse.json({ error: 'house boat not configured yet' }, { status: 503 });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || req.headers.get('x-real-ip') || 'unknown';
  const r = await fireDrill(account, ip);
  if (!r.ok) return NextResponse.json({ error: r.error, gate: r.gate }, { status: r.status });
  return NextResponse.json(r);
}
