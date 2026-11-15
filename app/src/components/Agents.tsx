'use client';
import { useEffect, useState } from 'react';
import { ago, short } from '@/lib/format';

type J = any;
interface Payments { count: number; revenueUsd: number; latest: { at: number; payer: string | null; amountUsd: number | null; explorer: string | null; vault: string | null; action: string | null }[] }

function usePayments() {
  const [p, setP] = useState<Payments | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()).then((j: J) => setP(j.payments ?? { count: 0, revenueUsd: 0, latest: [] }), () => setErr(true)); }, []);
  return { p, err };
}

const usdc = (n: number) => `${n.toFixed(2)} USDC`;

/** Live count, revenue and latest receipt for paid x402 checks. */
export function PaymentsLive() {
  const { p, err } = usePayments();
  if (err) return <p className="small dim">Payment totals unavailable right now.</p>;
  if (!p) return <p className="small dim">Reading paid checks…</p>;
  const last = p.latest[0];
  return (
    <div className="stat-row" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
      <div><div className="bignum">{p.count}</div><div className="small dim">paid checks so far</div></div>
      <div><div className="bignum">{p.revenueUsd.toFixed(2)}</div><div className="small dim">USDC earned from agents</div></div>
      <div className="small" style={{ paddingBottom: 6 }}>
        {last ? <>Latest receipt {ago(last.at)}: {last.explorer ? <a href={last.explorer} target="_blank" rel="noreferrer" className="mono">see it on Basescan</a> : 'no link'}{last.action ? <> · answer <b>{last.action}</b></> : null}</> : <span className="dim">No paid check yet. The first receipt shows here with its Basescan link.</span>}
      </div>
    </div>
  );
}

/** /proof: every recent paid check with its receipt. */
export function PaymentsProof() {
  const { p, err } = usePayments();
  if (err) return <div className="errbox">Payment records unavailable.</div>;
  if (!p) return null;
  return (
    <div>
      <div className="stat-row">
        <div><div className="bignum">{p.count}</div><div className="small dim">paid checks</div></div>
        <div><div className="bignum">{usdc(p.revenueUsd)}</div><div className="small dim">revenue</div></div>
      </div>
      {p.latest.length === 0 && <p className="dim">No paid checks recorded yet.</p>}
      {p.latest.map((x, k) => (
        <div className="txline" key={k}>
          <span className="k-dep">{x.amountUsd !== null ? `$${x.amountUsd.toFixed(2)}` : 'paid'}</span>
          <span>{x.action ? <b>{x.action}</b> : 'decision'} on vault {short(x.vault)}<span className="faint"> · payer {short(x.payer)} · {ago(x.at)}</span></span>
          {x.explorer ? <a href={x.explorer} target="_blank" rel="noreferrer">Basescan</a> : <span />}
        </div>
      ))}
    </div>
  );
}
