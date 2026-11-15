'use client';
import { useEffect, useState } from 'react';
import { pct, ratioPct, short, usd } from '@/lib/format';
import { Who } from './Who';

type J = any;
interface Answer {
  at: number; cached: boolean; ageS: number;
  record: J;
  explanation: { text: string; provider: string; model: string } | null;
  vault: { address: string; name: string; curator: string | null; chainId: number };
  market: { id: string; collateral: string; gapPct: number | null; utilization: number | null; allocationUsd: number | null };
}

const STAGES: [number, string][] = [
  [0, 'Reading the vault onchain…'],
  [7, 'Dolphin is deciding…'],
  [17, 'SERV is writing the explanation…'],
  [40, 'Still working. Live model calls can take a little longer…'],
];

export function AskNow({ address, chain }: { address: string; chain: 1 | 8453 }) {
  const [busy, setBusy] = useState(false);
  const [t0, setT0] = useState(0);
  const [now, setNow] = useState(0);
  const [a, setA] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [busy]);

  const ask = async () => {
    setBusy(true); setErr(null); setA(null); setOpen(null); setT0(Date.now()); setNow(Date.now());
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, chain }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setA(j);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const el = Math.max(0, (now - t0) / 1000);
  const stage = [...STAGES].reverse().find(([s]) => el >= s)?.[1] ?? STAGES[0]![1];
  const rec = a?.record ?? null;
  const d = rec?.decision ?? null;
  const m = rec?.model ?? null;
  const evidence: J[] = Array.isArray(rec?.evidence) ? rec.evidence : [];
  const evById = new Map(evidence.map((e) => [String(e.id), e]));
  const reasons: J[] = Array.isArray(d?.model?.reasons) ? d.model.reasons : [];
  const action = String(d?.action ?? '');

  return (
    <div className="ask">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn hot" onClick={ask} disabled={busy}>{busy ? 'Asking…' : a ? 'Ask again' : 'Ask Lifeboat now'}</button>
        <span className="small dim">{busy ? <span className="mono">{stage} {Math.floor(el)} s</span> : 'A live decision by the open model on this vault, from data read right now. About 20 seconds once the vault is loaded.'}</span>
      </div>
      {err && <div className="errbox" style={{ marginTop: 16 }}>{err}</div>}
      {a && d && (
        <div className="ask-res">
          <div className="ask-top">
            <div>
              <div className="eyebrow">Lifeboat says</div>
              <div className={`ask-act ${action}`}>{action}{action === 'WAIT' && d.waitMinutes ? <span className="ask-wait"> {d.waitMinutes} min</span> : null}</div>
              <div className="tiny faint mono"><Who decidedBy={d.decidedBy} model={m?.model} provider={m?.provider} rule={d.rule} />{a.cached ? ` · answered ${a.ageS < 90 ? `${a.ageS} s` : `${Math.round(a.ageS / 60)} min`} ago, cached for 5 min` : ''}</div>
            </div>
            <div className="ask-mkt">
              <div className="eyebrow">Market it judged</div>
              <div className="mcoll" style={{ fontSize: 30 }}>{a.market.collateral}</div>
              <div className="mono small">gap {pct(a.market.gapPct, 2, true)} · {ratioPct(a.market.utilization)} borrowed · vault has {usd(a.market.allocationUsd)} here</div>
            </div>
          </div>
          {a.explanation && (
            <div className="notice">
              <div className="tiny faint mono" style={{ marginBottom: 4 }}>Explained by SERV Reasoning ({a.explanation.model})</div>
              {a.explanation.text}
            </div>
          )}
          {!a.explanation && d.model?.summary && <p className="dim">{d.model.summary}</p>}
          {d.rule && <p className="small">Hard rule that decided: <b>{String(d.rule).replace(/_/g, ' ')}</b></p>}
          {reasons.length > 0 && (
            <div className="ask-reasons">
              <div className="eyebrow">Reasons, with the evidence they cite</div>
              {reasons.map((r, k) => (
                <div key={k} className="ask-reason">
                  <span>{r.claim}</span>{' '}
                  {(Array.isArray(r.evidence_ids) ? r.evidence_ids : []).map((id: string) => (
                    <button key={id} className={`evid${open === `${k}:${id}` ? ' on' : ''}`} onClick={() => setOpen(open === `${k}:${id}` ? null : `${k}:${id}`)}>{id}</button>
                  ))}
                  {open?.startsWith(`${k}:`) && (() => {
                    const e = evById.get(open.split(':')[1]!);
                    return <div className="evtext">{e ? <><span className="faint mono tiny">{e.id} · {e.kind}{e.source ? ` · ${e.source}` : ''}</span><br />{e.text}</> : 'That evidence id is not in the record.'}</div>;
                  })()}
                </div>
              ))}
            </div>
          )}
          {d.modelError && <p className="small hot-t">Model error, rules decided: {String(d.modelError).slice(0, 160)}</p>}
          <p className="tiny faint mono" style={{ marginTop: 18, wordBreak: 'break-all' }}>
            {m ? <><Who decidedBy="model" model={m.model} provider={m.provider} /> · {(m.inputTokens ?? 0) + (m.outputTokens ?? 0)} tokens · {m.costUsd == null ? 'cost not recorded' : `$${Number(m.costUsd).toFixed(6)}`} · </> : 'model not called · '}
            hash {short(rec.hash, 6)} · {evidence.length} evidence items
          </p>
          <p className="small dim" style={{ margin: '6px 0 0' }}>No transaction was sent. This is what Lifeboat would do for a $1,000 depositor right now.</p>
        </div>
      )}
    </div>
  );
}
