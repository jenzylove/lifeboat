'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress } from 'viem';
import { useBoard } from '@/lib/useBoard';
import type { BoardVault } from '@/lib/types';
import { ago, pct, usd } from '@/lib/format';
import { MarketRow } from './MarketRow';
import { ClockBadge } from './FeedLine';

export function Loading({ text }: { text: string }) {
  return (
    <div className="loading">
      <svg viewBox="0 0 80 20" aria-hidden="true"><path d="M0 10 Q10 2 20 10 T40 10 T60 10 T80 10 T100 10 T120 10" /></svg>
      {text}
    </div>
  );
}

function StatusSummary({ v }: { v: BoardVault }) {
  if (v.error) return <span className="chip unknown">snapshot unavailable</span>;
  const c = { calm: 0, watch: 0, clock: 0, unknown: 0 };
  for (const m of v.markets) c[m.status]++;
  return (
    <span className="chips">
      {c.clock > 0 && <ClockBadge label={`${c.clock} clock${c.clock > 1 ? 's' : ''}`} />}
      {c.watch > 0 && <span className="chip watch">{c.watch} watch</span>}
      {c.calm > 0 && <span className="chip calm">{c.calm} calm</span>}
      {c.unknown > 0 && <span className="chip unknown">{c.unknown} no price</span>}
    </span>
  );
}

function VaultRow({ v }: { v: BoardVault }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'open' : ''}>
      <button className="brow" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div>
          <div className="vname">{v.name}</div>
          <div className="vcur">{v.curator ?? 'curator unknown'} · {v.markets.length} markets</div>
        </div>
        <div className="num c-tvl"><span className="mlabel-s">holds</span>{usd(v.tvlUsd)}</div>
        <div className="num c-apy"><span className="mlabel-s">earns</span>{v.apy === null ? 'unavailable' : pct(v.apy * 100, 2)}</div>
        <div className="c-st"><StatusSummary v={v} /></div>
        <div className="small dim c-cur"><span className="mlabel-s">curator</span>{v.lastConfigActionAt ? `last changed settings ${ago(v.lastConfigActionAt)}` : v.errors.curatorEvents ? 'curator history unavailable' : 'no settings change in 7 days'}</div>
        <svg className="chev" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M6 3l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
      </button>
      {open && (
        <div className="bmarkets">
          {v.error && <div className="errbox">This vault could not be read right now: {v.error}</div>}
          <p className="small dim" style={{ margin: '4px 0 8px' }}>
            {v.errors.curatorEvents ? 'Curator history unavailable right now.' : <>
              Curator {v.lastConfigActionAt ? `last changed settings ${ago(v.lastConfigActionAt)}` : 'made no settings change in the last 7 days'}.
              {' '}Allocator {v.lastAllocatorActionAt ? `last moved money ${ago(v.lastAllocatorActionAt)}` : 'moved no money in the last 7 days'}.</>}{' '}
            <a href={`/vault/${v.address}`}>Open the full vault page</a>
          </p>
          {v.markets.map((m) => <MarketRow key={m.marketId} m={m} />)}
        </div>
      )}
    </div>
  );
}

export function PasteBox() {
  const r = useRouter();
  const [val, setVal] = useState('');
  const [chain, setChain] = useState('8453');
  const [err, setErr] = useState<string | null>(null);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const a = val.trim();
    if (!isAddress(a)) { setErr('That is not a vault address. It starts with 0x and has 42 characters.'); return; }
    r.push(`/vault/${a}${chain === '1' ? '?chain=1' : ''}`);
  };
  return (
    <form onSubmit={go}>
      <div className="paste">
        <input value={val} onChange={(e) => { setVal(e.target.value); setErr(null); }} placeholder="Paste any Morpho vault address" spellCheck={false} aria-label="Morpho vault address" />
        <button type="submit">Watch it</button>
      </div>
      <div className="paste-row small dim">
        <label>Chain <select value={chain} onChange={(e) => setChain(e.target.value)}><option value="8453">Base</option><option value="1">Ethereum</option></select></label>
        {err && <span className="hot-t">{err}</span>}
      </div>
      <p className="small dim" style={{ margin: '10px 0 0' }}>Paste any vault, then press Ask Lifeboat now: Dolphin decides on live data in about 20 seconds.</p>
    </form>
  );
}

export function BoardTable() {
  const { board, error } = useBoard();
  if (error && !board) return <div className="errbox">The live board could not be read: {error}</div>;
  if (!board) return <Loading text="Reading every market on Base right now. The first read takes about a minute; after that it refreshes every 60 seconds." />;
  return (
    <div>
      <div className="board">
        <div className="brow head" role="presentation">
          <div>Vault and curator</div><div>Holds</div><div>Earns</div><div>Markets</div><div>Curator</div><div />
        </div>
        {board.vaults.map((v) => <VaultRow key={v.address} v={v} />)}
      </div>
      <p className="tiny faint mono" style={{ marginTop: 14 }}>
        Read {ago(board.readAt)} from Morpho, Base RPC and DefiLlama{board.stale ? ', refreshing now' : ''}. Calm: gap under 1%. Watch: 1 to 5%. Clock: oracle 5% or more above the market, the side where lenders lose.
      </p>
    </div>
  );
}

export function LiveStrip() {
  const { board, error } = useBoard();
  if (error && !board) return <div className="live-strip"><span className="live-dot hot" />Live board unavailable right now: {error}</div>;
  if (!board) return <div className="live-strip"><span className="live-dot" />Reading Base vaults right now…</div>;
  const k = board.totals.clocks;
  return (
    <div className="live-strip">
      <span className={`live-dot${k ? ' hot' : ''}`} />
      <span>Watching <b>{board.totals.markets} markets</b> across <b>{board.totals.vaults} Base vaults</b> right now, <span className={k ? 'k' : ''}>{k} clock{k === 1 ? '' : 's'} open</span>.</span>
    </div>
  );
}
