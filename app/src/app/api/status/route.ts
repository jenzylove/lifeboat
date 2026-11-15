import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/server/config';
import { redact } from '@/lib/server/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJson(f: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; }
}

const clean = (w: any) => (w && w.error ? { ...w, error: redact(w.error) } : w);

/** Live watcher status: DATA_DIR/state.json (heartbeat + totals) and the newest DATA_DIR/sweeps/*.json. */
export async function GET(req: Request) {
  const nSweeps = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get('sweeps') ?? 1)));
  const state = await readJson(path.join(DATA_DIR, 'state.json'));
  let sweeps: unknown[] = [];
  try {
    const dir = path.join(DATA_DIR, 'sweeps');
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
    const withTime = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(path.join(dir, n))).mtimeMs })));
    withTime.sort((a, b) => b.t - a.t);
    sweeps = (await Promise.all(withTime.slice(0, nSweeps).map((x) => readJson(path.join(dir, x.n))))).filter(Boolean);
  } catch {}
  return NextResponse.json({
    configured: state !== null,
    heartbeat: state?.heartbeat ? { ...state.heartbeat, errors: Array.isArray(state.heartbeat.errors) ? state.heartbeat.errors.map(redact) : state.heartbeat.errors ? [redact(state.heartbeat.errors)] : [] } : null,
    totals: state?.totals ?? null,
    latestSweep: clean(sweeps[0]) ?? null,
    sweeps: sweeps.map(clean),
    now: Math.floor(Date.now() / 1000),
  });
}
