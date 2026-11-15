import { NextResponse } from 'next/server';
import { getDecision, listDecisions } from '@/lib/server/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const hash = new URL(req.url).searchParams.get('hash');
  if (hash) {
    const r = await getDecision(hash);
    return r ? NextResponse.json(r) : NextResponse.json({ error: 'no record with that hash' }, { status: 404 });
  }
  return NextResponse.json(await listDecisions());
}
