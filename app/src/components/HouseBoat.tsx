'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, short, usd } from '@/lib/format';
import { Loading } from './Board';

interface Pos { vault: string; name: string; allowed: boolean; assets: number; withdrawable: number }
interface Status { account: string; owner: string; keeper: string; paused: boolean; idle: number; positions: Pos[]; total: number; readAt: number }
interface Ev { kind: 'Exited' | 'Deposited'; vault: string; assets: number; by: string; decisionHash: string | null; reason: string | null; blockNumber: number; timestamp: number | null; txHash: string; explorer: string }
interface House {
  configured: boolean; account?: string; explorer?: string; error?: string;
  status?: Status; events?: Ev[]; eventsError?: string;
  drill?: { allowed: boolean; nextAt: number; running: boolean; reason: string | null };
}
interface DrillResult { recordHash: string; tx: { hash: string; status: string; block: number; explorer: string }; from: string; to: string; before: Status; after: Status }

function Positions({ s, title }: { s: Status; title: string }) {
  return (
    <div>
      <div className="eyebrow">{title}</div>
      {s.positions.map((p) => (
        <div className="pos" key={p.vault}>
          <span className="n">{p.name}<br /><a className="tiny faint mono" href={`https://basescan.org/address/${p.vault}`} target="_blank" rel="noreferrer">{short(p.vault)}</a></span>
          <span className="a">{usd(p.assets, 2)}<br /><span className="tiny faint">{usd(p.withdrawable, 2)} can leave now</span></span>
        </div>
      ))}
      <div className="pos"><span className="n">Idle in the account</span><span className="a">{usd(s.idle, 2)}</span></div>
    </div>
  );
}

export function HouseBoat() {
  const [h, setH] = useState<House | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DrillResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now() / 1000);

  const load = useCallback(() => fetch('/api/house', { cache: 'no-store' }).then((r) => r.json()).then(setH, (e: Error) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, [load]);

  const drill = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch('/api/drill', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRes(j);
      load();
    } catch (e) { setErr((e as Error).message); load(); } finally { setBusy(false); }
  };

  if (!h) return <Loading text="Reading the house boat on Base" />;
  if (!h.configured) {
    return (
      <div className="notice hot">
        <b>The house boat launches shortly.</b> It will be a real Lifeboat account on Base holding real USDC, and anyone here will be able to make it run a real exit and re park. No numbers are shown until it is live.
      </div>
    );
  }
  if (h.error || !h.status) return <div className="errbox">The house boat could not be read right now: {h.error}</div>;
  const s = h.status;
  const wait = h.drill && !h.drill.allowed ? Math.max(0, Math.ceil(h.drill.nextAt - now)) : 0;

  return (
    <div className="split">
      <div>
        <div className="eyebrow">On board right now</div>
        <div className="bignum">{usd(s.total, 2)}</div>
        <p className="small dim">USDC in account <a href={h.explorer} target="_blank" rel="noreferrer" className="mono">{short(s.account)}</a>, read {ago(s.readAt, now)}. Keeper {s.paused ? 'paused by the owner' : 'on watch'}.</p>
        <Positions s={s} title="Where it sits" />
        <div style={{ marginTop: 28, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn hot" onClick={drill} disabled={busy || (!!h.drill && !h.drill.allowed)}>
            {busy ? 'Running the drill on Base…' : 'Run a fire drill'}
          </button>
          <span className="small dim">
            {busy ? 'The keeper is sending a real transaction. This takes about 10 to 30 seconds.'
              : h.drill && !h.drill.allowed ? (h.drill.running ? 'A drill is running right now.' : `One drill every 10 minutes for everyone. Next one opens in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}.`)
              : 'Moves everything out of one approved vault and parks it in the other. Real transaction, real money.'}
          </span>
        </div>
        {err && <div className="errbox" style={{ marginTop: 16 }}>{err}</div>}
      </div>
      <div>
        {res ? (
          <div>
            <div className="eyebrow">Fire drill done</div>
            <p className="notice hot">
              The keeper exited {res.before.positions.find((p) => p.vault === res.from)?.name ?? short(res.from)} and parked everything in {res.after.positions.find((p) => p.vault === res.to)?.name ?? short(res.to)}.{' '}
              <a href={res.tx.explorer} target="_blank" rel="noreferrer">See the transaction on Basescan</a>
            </p>
            <p className="tiny faint mono" style={{ wordBreak: 'break-all' }}>record hash {res.recordHash} · block {res.tx.block} · {res.tx.status}</p>
            <Positions s={res.before} title="Before" />
            <div style={{ height: 18 }} />
            <Positions s={res.after} title="After" />
          </div>
        ) : (
          <div>
            <div className="eyebrow">Recent moves on this account</div>
            {h.eventsError && <p className="small hot-t">Event history unavailable: {h.eventsError}</p>}
            {(h.events ?? []).length === 0 && !h.eventsError && <p className="small dim">No moves in the last day or so of blocks.</p>}
            {(h.events ?? []).map((e) => (
              <div className="txline" key={e.txHash + e.kind}>
                <span className={e.kind === 'Exited' ? 'k-ex' : 'k-dep'}>{e.kind === 'Exited' ? 'Exited' : 'Parked'}</span>
                <span>{usd(e.assets, 2)} {e.kind === 'Exited' ? 'out of' : 'into'} {s.positions.find((p) => p.vault.toLowerCase() === e.vault.toLowerCase())?.name ?? short(e.vault)}<span className="faint"> · {e.timestamp ? ago(e.timestamp, now) : `block ${e.blockNumber}`}</span></span>
                <a href={e.explorer} target="_blank" rel="noreferrer">{short(e.txHash)}</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
