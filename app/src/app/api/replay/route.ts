import { NextResponse } from 'next/server';
import { readReplayFiles } from '@/lib/server/data';
import { buildReplayView } from '@/lib/replayView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const r = await readReplayFiles();
  const view = buildReplayView(r.files, r.decisions);
  if (new URL(req.url).searchParams.get('raw') === '1') return NextResponse.json({ ...r, view });
  return NextResponse.json({ view, files: Object.keys(r.files), hasDecisions: r.decisions !== null, errors: r.errors });
}
