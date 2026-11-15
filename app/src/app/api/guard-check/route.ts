import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPLAY_DIR } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Evidence file from a real SERV PromptGuard run: data/guard-check.json (ships in the repo next to data/replay). */
export async function GET() {
  try {
    return NextResponse.json({ available: true, ...JSON.parse(await fs.readFile(path.resolve(REPLAY_DIR, '..', 'guard-check.json'), 'utf8')) });
  } catch {
    return NextResponse.json({ available: false });
  }
}
