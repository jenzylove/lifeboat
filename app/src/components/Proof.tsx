'use client';
import { useEffect, useState } from 'react';
import type { DecisionSummary, PublicConfig } from '@/lib/types';
import { ago, short, utcDate } from '@/lib/format';
import { Loading } from './Board';
import { Who } from './Who';
import { GuardLine } from './Guard';

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
            {r.ask && <div className="chip" style={{ display: 'inline-block', margin: '6px 0' }}>On demand check</div>}
            <div className="tiny faint mono"><Who decidedBy={r.decidedBy} model={r.model?.model} provider={r.model?.provider} rule={r.rule} /></div>
          </div>
          <div>
            <div>{r.summary ?? (r.rule ? `Rule: ${r.rule.replace(/_/g, ' ')}` : 'No summary in the record.')}</div>
            {r.notice && <div className="notice"><div className="tiny faint mono" style={{ marginBottom: 4 }}>Notice written by SERV Reasoning ({r.noticeModel ?? 'model not recorded'})</div>{r.notice}</div>}
            {r.tx && <div className="meta">{r.tx.explorer ? <a href={r.tx.explorer} target="_blank" rel="noreferrer">transaction {r.tx.hash ? short(r.tx.hash, 6) : ''}</a> : null}{r.tx.ok === false && <span className="hot-t">transaction failed{r.tx.error ? `: ${r.tx.error}` : ''}</span>}</div>}
            <div className="meta">
              <span>{utcDate(r.at)} ({ago(r.at)})</span>
              <span>{r.mode}</span>
              <span>{r.vaultName ? `${r.vaultName}${r.collateral ? `, ${r.collateral} market` : ''}` : `vault ${short(r.vault)}`}</span>
              {r.model ? <span>{r.model.model} · {r.model.inputTokens + r.model.outputTokens} tokens · {r.model.costUsd === null ? 'cost not recorded' : `$${r.model.costUsd.toFixed(6)}`}</span> : <span>model {r.modelError ? `unavailable: ${r.modelError.slice(0, 80)}` : 'not called'}</span>}
              <span>{r.evidenceCount} evidence items</span>
            </div>
            {r.secondOpinion && (
              <div className="meta">
                <span>SERV second opinion ({r.secondOpinion.model ?? 'model not recorded'}): {r.secondOpinion.error ? <span className="hot-t">unavailable, {r.secondOpinion.error.slice(0, 100)}</span> : <>{r.secondOpinion.action ?? 'no answer'}, {r.secondOpinion.applied ? <b>applied{r.secondOpinion.firstAction ? ` (first call was ${r.secondOpinion.firstAction})` : ''}</b> : 'kept the first call'}</>}</span>
              </div>
            )}
            <GuardLine guard={r.guard} compact />
            <div className="meta"><a href={`/api/decisions?hash=${r.hash}`} target="_blank" rel="noreferrer">hash {r.hash}</a></div>
          </div>
        </div>
      ))}
    </div>
  );
}
