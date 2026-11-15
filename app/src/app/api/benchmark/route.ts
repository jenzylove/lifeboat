import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** data/benchmark.json ships in the repo: the three arm decision benchmark. */
export async function GET() {
  try {
    return NextResponse.json({ available: true, ...JSON.parse(await fs.readFile(path.resolve(process.cwd(), '../data/benchmark.json'), 'utf8')) });
  } catch {
    return NextResponse.json({ available: false });
  }
}
