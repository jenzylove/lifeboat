'use client';
import { useEffect, useState } from 'react';
import type { DecisionSummary, PublicConfig } from '@/lib/types';
import { ago, short, utcDate } from '@/lib/format';
import { Loading } from './Board';

export function useConfig() {
  const [c, setC] = useState<PublicConfig | null>(null);
  useEffect(() => { fetch('/api/config').then((r) => r.json()).then(setC, () => {}); }, []);
  return c;
}

function Addr({ a, label, note }: { a: string | null; label: string; note?: string }) {
  return (
    <div>
      <span className="l">{label}</span>
      <span className="v">
        {a ? <a href={`https://basescan.org/address/${a}`} target="_blank" rel="noreferrer">{a}</a> : <span className="faint">deploying shortly</span>}
        {note && <span className="faint" style={{ display: 'block', wordBreak: 'normal', fontFamily: 'var(--f-b)', fontSize: 13, marginTop: 4 }}>{note}</span>}
      </span>
    </div>
  );
}

export function Contracts() {
  const c = useConfig();
  if (!c) return <Loading text="Reading config" />;
  return (
    <div className="addr-list">
      <Addr label="Lifeboat factory" a={c.factory} note="Creates one account per person. Source: contracts/src/LifeboatFactory.sol" />
      <Addr label="House boat account" a={c.houseAccount} note="Real account with real USDC. Anyone can run a fire drill on it." />
      <Addr label="Keeper" a={c.keeper} note="The only key that can call exit and move. It cannot send money anywhere but an approved vault or the account." />
      {c.approvedVaults.map((v) => <Addr key={v.address} label={`Approved: ${v.name}`} a={v.address} />)}
      <div><span className="l">Source</span><span className="v"><a href={c.repo} target="_blank" rel="noreferrer">{c.repo}</a></span></div>
    </div>
  );
}

export function Decisions({ limit = 50 }: { limit?: number }) {
  const [d, setD] = useState<DecisionSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/decisions', { cache: 'no-store' }).then((r) => r.json()).then((j) => setD(j.decisions ?? []), (e: Error) => setErr(e.message));
  }, []);
  if (err) return <div className="errbox">Decision records unavailable: {err}</div>;
  if (!d) return <Loading text="Reading decision records" />;
  if (!d.length) return <p className="dim">No live decision records yet. The watcher writes one every time a clock is open; when every market is calm there is nothing to decide, and that is the normal state.</p>;
  return (
    <div>
      {d.slice(0, limit).map((r) => (
        <div className="rec" key={r.hash + r.file}>
          <div>
            <div className={`act ${r.action}`}>{r.action}</div>
            <div className="tiny faint mono">{r.decidedBy === 'rule' ? 'rule decided' : r.decidedBy === 'model_clamped' ? 'model, clamped by code' : 'Dolphin model decided'}</div>
          </div>
          <div>
            <div>{r.notice ?? r.summary ?? (r.rule ? `Rule: ${r.rule}` : 'No summary in the record.')}</div>
            <div className="meta">
              <span>{utcDate(r.at)} ({ago(r.at)})</span>
              <span>{r.mode}</span>
              <span>vault {short(r.vault)}</span>
              {r.model ? <span>{r.model.model} · {r.model.inputTokens + r.model.outputTokens} tokens · {r.model.costUsd === null ? 'cost unavailable' : `$${r.model.costUsd.toFixed(6)}`}</span> : <span>model {r.modelError ? `unavailable: ${r.modelError.slice(0, 80)}` : 'not called'}</span>}
              <span>{r.evidenceCount} evidence items</span>
            </div>
            <div className="meta"><a href={`/api/decisions?hash=${r.hash}`} target="_blank" rel="noreferrer">hash {r.hash}</a></div>
          </div>
        </div>
      ))}
    </div>
  );
}
