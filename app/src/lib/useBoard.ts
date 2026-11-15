'use client';
import { useEffect, useState } from 'react';
import type { Board } from './types';

let inflight: Promise<Board> | null = null;
let last: { at: number; b: Board } | null = null;

function load(): Promise<Board> {
  if (last && Date.now() - last.at < 30_000) return Promise.resolve(last.b);
  inflight ??= fetch('/api/board', { cache: 'no-store' })
    .then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `board HTTP ${r.status}`);
      last = { at: Date.now(), b: j as Board };
      return j as Board;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** One shared fetch of /api/board for every component on the page; refreshes every 60 s. */
export function useBoard() {
  const [board, setBoard] = useState<Board | null>(last?.b ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const go = () => load().then((b) => { if (alive) { setBoard(b); setError(null); } }, (e: Error) => { if (alive) setError(e.message); });
    go();
    const t = setInterval(go, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { board, error };
}
