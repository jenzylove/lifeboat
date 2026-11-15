'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { VaultView } from '@/lib/types';
import { ago, explorerFor, pct, short, usd, utcDate } from '@/lib/format';
import { MarketRow, Sources } from './MarketRow';
import { Loading, PasteBox } from './Board';
import { ClockBadge } from './FeedLine';

export function VaultLive({ address, chain }: { address: string; chain: 1 | 8453 }) {
  const [v, setV] = useState<VaultView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const go = () => fetch(`/api/vault/${address}?chain=${chain}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as VaultView; })
      .then((j) => { if (alive) { setV(j); setErr(null); } }, (e: Error) => { if (alive) setErr(e.message); });
    go();
    const t = setInterval(go, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [address, chain]);
  const ex = explorerFor(chain);
  useEffect(() => { document.title = v ? `${v.name} · Lifeboat` : 'Vault · Lifeboat'; }, [v]);

  return (
    <main className="wrap">
      <div className="phead">
        <Link href="/#board" className="crumb">Back to the board</Link>
        {!v && !err && (
          <>
            <h1 className="display" style={{ marginTop: 18 }}>Reading vault</h1>
            <p className="mono small dim" style={{ wordBreak: 'break-all' }}>{address} on {chain === 1 ? 'Ethereum' : 'Base'}</p>
            <Loading text="Reading every market, price feed and curator transaction. About 15 seconds." />
          </>
        )}
        {err && !v && (
          <>
            <h1 className="display" style={{ marginTop: 18 }}>No vault here</h1>
            <div className="errbox">{err}</div>
            <p className="dim">Check the address and the chain. Lifeboat reads Morpho vaults on Base and Ethereum.</p>
            <PasteBox />
          </>
        )}
        {v && (
          <>
            <div className="eyebrow" style={{ marginTop: 18 }}>{chain === 1 ? 'Ethereum' : 'Base'} · Morpho vault {v.version}</div>
            <h1 className="display" style={{ margin: '10px 0 18px' }}>{v.name}</h1>
            <div className="chips" style={{ marginBottom: 22 }}>
              {v.openClocks > 0 ? <ClockBadge label={`${v.openClocks} clock${v.openClocks > 1 ? 's' : ''} open`} /> : <span className="chip calm">no clock open</span>}
            </div>
            <dl className="kv">
              <dt>Curator</dt><dd>{v.curator ?? 'unknown'}{v.curatorAddress && <> · <a href={`${ex}/address/${v.curatorAddress}`} target="_blank" rel="noreferrer">{short(v.curatorAddress)}</a></>}</dd>
              <dt>Holds</dt><dd>{usd(v.tvlUsd)}</dd>
              <dt>Earns</dt><dd>{v.apy === null ? 'unavailable' : pct(v.apy * 100)} a year</dd>
              <dt>Can leave now</dt><dd>{usd(v.withdrawableUsd)}</dd>
              <dt>Idle cash</dt><dd>{usd(v.idleUsd)}</dd>
              <dt>Settings changed</dt><dd>{v.lastConfigActionAt ? ago(v.lastConfigActionAt) : 'not in the window read'}</dd>
              <dt>Money moved</dt><dd>{v.lastAllocatorActionAt ? ago(v.lastAllocatorActionAt) : 'not in the window read'}</dd>
              <dt>Address</dt><dd><a href={`${ex}/address/${v.address}`} target="_blank" rel="noreferrer">{v.address}</a></dd>
              <dt>Read</dt><dd>{utcDate(v.readAt)}</dd>
            </dl>
            <Sources sources={v.sources} errors={v.errors} />
          </>
        )}
      </div>
      {v && (
        <>
          <section className="section" style={{ paddingTop: 48 }}>
            <h2 className="display" style={{ fontSize: 'clamp(36px,5vw,64px)', marginBottom: 20 }}>Markets</h2>
            {v.markets.length === 0 && <p className="dim">This vault has no lending markets right now, only idle cash.</p>}
            {v.markets.map((m) => <MarketRow key={m.marketId} m={m} />)}
          </section>
          <section className="section" style={{ paddingTop: 48 }}>
            <h2 className="display" style={{ fontSize: 'clamp(36px,5vw,64px)', marginBottom: 8 }}>Curator moves</h2>
            <p className="small dim">
              {v.curatorEventsWindow ? `${v.curatorEventsTotal} onchain actions in the last ${Math.round(v.curatorEventsWindow.lookbackSeconds / 86400)} days (blocks ${v.curatorEventsWindow.fromBlock} to ${v.curatorEventsWindow.toBlock}).` : 'Curator history unavailable right now.'}
              {' '}Cap changes and queue edits are the curator; reallocations are usually an allocator bot.
            </p>
            {v.curatorEvents.length === 0 && <p className="dim">No curator transactions in this window.</p>}
            {v.curatorEvents.slice(0, 60).map((e) => (
              <div className="txline" key={e.txHash + e.kind + e.blockNumber}>
                <span className={/Realloc|Allocate|Deallocate/.test(e.kind) ? 'k-dep' : 'k-ex'}>{e.kind}</span>
                <span>{e.timestamp ? `${utcDate(e.timestamp)} · ${ago(e.timestamp)}` : `block ${e.blockNumber}`}{e.marketId && <span className="faint"> · market {short(e.marketId, 4)}</span>}</span>
                <a href={e.explorer} target="_blank" rel="noreferrer">{short(e.txHash)}</a>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
