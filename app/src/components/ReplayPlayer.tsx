'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DecisionPoint, DecisionsView, Incident, PositionView, ReplayMarket, ReplayPayload, SweepView } from '@/lib/replayView';
import { price, pct, ratioPct, usd, short, whoDecided } from '@/lib/format';
import { Who } from './Who';
import { Loading } from './Board';

const W = 1000, H = 400, PL = 52, PR = 16, PT = 22, PRICE_B = 236, UT = 286, UB = 362;

const hm = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const hmShort = (t: number) => { const d = new Date(t * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const span = (min: number) => { const a = Math.abs(Math.round(min)); return a >= 120 ? `${Math.floor(a / 60)} h ${a % 60} min` : `${a} min`; };
const after = (a: number | null, b: number, what = 'the clock') => {
  if (a === null) return '';
  const m = Math.round((b - a) / 60);
  return m === 0 ? `as ${what} opened` : `${span(m)} ${m > 0 ? 'after' : 'before'} ${what}`;
};
const byWho = (d: { decidedBy: string; model: string | null; provider?: string | null; rule?: string | null }) => { const w = whoDecided(d.decidedBy, d.model, d.provider, d.rule); return w.standIn ? `${w.text} (stand-in model, not Dolphin)` : w.text; };

type Zoom = 'break' | 'all';
interface Marker { ts: number; action: string; clockKind: string | null; vaults: string[]; d: DecisionPoint }

function markersFor(m: ReplayMarket, dec: DecisionsView | null): Marker[] {
  if (!dec) return [];
  const map = new Map<string, Marker>();
  for (const p of dec.positions) {
    if (p.marketId.toLowerCase() !== m.marketId.toLowerCase()) continue;
    for (const d of p.decisions) {
      const k = `${d.ts}:${d.action}`;
      const e = map.get(k);
      if (e) e.vaults.push(p.vaultName); else map.set(k, { ts: d.ts, action: d.action, clockKind: d.clockKind, vaults: [p.vaultName], d });
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}
const sweepFor = (m: ReplayMarket, dec: DecisionsView | null): { s: SweepView; reason: string | null; relatedTo: string[] } | null => {
  if (!dec) return null;
  for (const s of dec.sweeps) {
    const f = s.flags.find((x) => x.marketId.toLowerCase() === m.marketId.toLowerCase());
    if (f) return { s, reason: f.reason, relatedTo: f.relatedTo };
  }
  return null;
};

function Chart({ m, zoom, i, setI, markers, sweepAt, onPick }: {
  m: ReplayMarket; zoom: Zoom; i: number; setI: React.Dispatch<React.SetStateAction<number>>; markers: Marker[]; sweepAt: number | null; onPick: (mk: Marker) => void;
}) {
  const pts = useMemo(() => {
    if (zoom === 'all' || !m.clockOpenAt) return m.points;
    const lo = Math.min(m.clockOpenAt, m.fullUtilAt ?? Infinity, sweepAt ?? Infinity) - 3 * 3600, hi = m.clockOpenAt + 6 * 3600;
    const s = m.points.filter((p) => p.ts >= lo && p.ts <= hi);
    return s.length >= 2 ? s : m.points;
  }, [m, zoom, sweepAt]);
  const n = pts.length;
  const geo = useMemo(() => {
    const t0 = pts[0]!.ts, t1 = pts[n - 1]!.ts;
    const prices = pts.flatMap((p) => [p.oraclePrice, p.marketPrice]).filter((x): x is number => x !== null);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    const pad = (hi - lo) * 0.1 || 0.05; lo = Math.max(0, lo - pad); hi += pad;
    const x = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * (W - PL - PR);
    const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (PRICE_B - PT);
    const yu = (u: number) => UB - Math.max(0, Math.min(1, u)) * (UB - UT);
    const line = (k: 'oraclePrice' | 'marketPrice', upto: number) => {
      let d = ''; let pen = false;
      for (let j = 0; j < upto; j++) { const v = pts[j]![k]; if (v === null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(pts[j]!.ts).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; }
      return d;
    };
    const gapArea = (upto: number) => {
      const s = pts.slice(0, upto).filter((p) => p.oraclePrice !== null && p.marketPrice !== null && p.oraclePrice > p.marketPrice);
      if (s.length < 2) return '';
      return 'M' + s.map((p) => `${x(p.ts).toFixed(1)} ${y(p.oraclePrice!).toFixed(1)}`).join(' L') + ' L' + [...s].reverse().map((p) => `${x(p.ts).toFixed(1)} ${y(p.marketPrice!).toFixed(1)}`).join(' L') + ' Z';
    };
    const area = (upto: number) => {
      const us = pts.slice(0, upto).filter((p) => p.utilization !== null);
      if (us.length < 2) return '';
      return `M${x(us[0]!.ts)} ${UB} ` + us.map((p) => `L${x(p.ts).toFixed(1)} ${yu(p.utilization!).toFixed(1)}`).join(' ') + ` L${x(us[us.length - 1]!.ts)} ${UB} Z`;
    };
    const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * k) / 4);
    const tticks = Array.from({ length: 6 }, (_, k) => t0 + ((t1 - t0) * k) / 5);
    const priceAt = (t: number) => [...pts].reverse().find((q) => q.ts <= t && q.marketPrice !== null)?.marketPrice ?? null;
    return { t0, t1, x, y, yu, line, area, gapArea, ticks, tticks, priceAt };
  }, [pts, n]);
  const k = Math.min(i, n - 1);
  const cur = pts[k]!;
  const shown = (t: number | null) => t !== null && t >= geo.t0 && t <= geo.t1 && t <= cur.ts;
  const multiDay = geo.t1 - geo.t0 > 20 * 3600;

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Oracle price versus market price for ${m.label}`}
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const t = geo.t0 + ((((e.clientX - r.left) / r.width) * W - PL) / (W - PL - PR)) * (geo.t1 - geo.t0);
          let best = 0; for (let j = 0; j < n; j++) if (Math.abs(pts[j]!.ts - t) < Math.abs(pts[best]!.ts - t)) best = j;
          setI(best);
        }}>
        {geo.ticks.map((v) => (
          <g key={v}><line className="grid" x1={PL} x2={W - PR} y1={geo.y(v)} y2={geo.y(v)} /><text className="ax" x={PL - 8} y={geo.y(v) + 4} textAnchor="end">{v.toFixed(2)}</text></g>
        ))}
        {geo.tticks.map((t) => <text key={t} className="ax" x={geo.x(t)} y={H - 6} textAnchor="middle">{multiDay ? hm(t) : hmShort(t)}</text>)}
        <text className="ax" x={PL - 8} y={UT + 4} textAnchor="end">100%</text>
        <text className="ax" x={PL - 8} y={UB + 4} textAnchor="end">0%</text>
        <text className="ax" x={PL + 4} y={UT - 4}>share borrowed</text>
        <line className="grid" x1={PL} x2={W - PR} y1={UB} y2={UB} />
        <path d={geo.line('oraclePrice', n)} className="oracle" opacity=".2" />
        <path d={geo.line('marketPrice', n)} className="market" opacity=".15" />
        <path d={geo.area(n)} className="util" opacity=".25" />
        <path d={geo.gapArea(k + 1)} className="gap" />
        <path d={geo.area(k + 1)} className="util" />
        <path d={geo.line('oraclePrice', k + 1)} className="oracle" />
        <path d={geo.line('marketPrice', k + 1)} className="market" />
        {shown(sweepAt) && (
          <g><line className="mk-clock" x1={geo.x(sweepAt!)} x2={geo.x(sweepAt!)} y1={PT - 8} y2={UB} style={{ strokeDasharray: '1 4', strokeWidth: 2 }} /><text className="mk-lbl" x={geo.x(sweepAt!) - 5} y={PRICE_B - 6} textAnchor="end" style={{ fill: 'var(--hot-text)' }}>sweep links it {hmShort(sweepAt!)}</text></g>
        )}
        {shown(m.clockOpenAt) && (
          <g><line className="mk-clock" x1={geo.x(m.clockOpenAt!)} x2={geo.x(m.clockOpenAt!)} y1={PT - 8} y2={UB} /><text className="mk-lbl" x={geo.x(m.clockOpenAt!) + 5} y={PT} style={{ fill: 'var(--hot-text)' }}>price breaks {hmShort(m.clockOpenAt!)}</text></g>
        )}
        {shown(m.fullUtilAt) && (
          <g><line className="mk-clock" x1={geo.x(m.fullUtilAt!)} x2={geo.x(m.fullUtilAt!)} y1={UT} y2={UB} style={{ stroke: 'var(--sea)' }} /><text className="mk-lbl" x={geo.x(m.fullUtilAt!) + 5} y={UT + 12}>fully borrowed {hmShort(m.fullUtilAt!)}</text></g>
        )}
        {m.vaults.filter((v) => v.firstAction && shown(v.firstAction.ts)).map((v, j) => (
          <a key={v.address + j} href={v.firstAction!.explorer} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            <circle className="mk-cur" cx={geo.x(v.firstAction!.ts)} cy={PRICE_B + 16 + (j % 2) * 10} r={4.5}><title>{`${hm(v.firstAction!.ts)} ${v.name}: ${v.firstAction!.label}`}</title></circle>
          </a>
        ))}
        {markers.filter((mk) => shown(mk.ts)).map((mk, j) => {
          const p = geo.priceAt(mk.ts);
          const yy = p !== null ? geo.y(p) : PT + 10;
          return (
            <g key={j} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onPick(mk); }}>
              <circle cx={geo.x(mk.ts)} cy={yy} r={14} fill="transparent" />
              <circle className="mk-dec" cx={geo.x(mk.ts)} cy={yy} r={mk.action === 'LEAVE' ? 7.5 : 4.5}>
                <title>{`${hm(mk.ts)} ${byWho(mk.d)}: ${mk.action}${mk.d.summary ? `. ${mk.d.summary}` : ''}`}</title>
              </circle>
              {mk.action === 'LEAVE' && <text className="mk-lbl" x={geo.x(mk.ts) + 10} y={yy - 8} style={{ fill: 'var(--hot-text)', fontWeight: 700 }}>LEAVE</text>}
            </g>
          );
        })}
        <line className="cursor" x1={geo.x(cur.ts)} x2={geo.x(cur.ts)} y1={PT - 8} y2={UB} />
      </svg>
      <Readout cur={cur} />
      <Controls n={n} i={k} setI={setI} label={hm(cur.ts) + ' UTC'} />
    </>
  );
}

function Readout({ cur }: { cur: ReplayMarket['points'][number] }) {
  const gap = cur.oraclePrice !== null && cur.marketPrice !== null && cur.oraclePrice > 0 ? ((cur.oraclePrice - cur.marketPrice) / cur.oraclePrice) * 100 : null;
  return (
    <div className="readout">
      <div><span className="l">Oracle said</span><span className="v hot-t">{price(cur.oraclePrice)}</span></div>
      <div><span className="l">Market said</span><span className="v">{price(cur.marketPrice)}</span></div>
      <div><span className="l">Gap</span><span className="v">{pct(gap, 1)}</span></div>
      <div><span className="l">Borrowed / cash left</span><span className="v">{ratioPct(cur.utilization)} · {usd(cur.withdrawable)}</span></div>
    </div>
  );
}

function Controls({ n, i, setI, label }: { n: number; i: number; setI: React.Dispatch<React.SetStateAction<number>>; label: string }) {
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const msPer = 16000 / n;
    const step = (t: number) => {
      if (t - last >= msPer) {
        const adv = Math.floor((t - last) / msPer); last = t;
        setI((x) => { const nx = Math.min(n - 1, x + adv); if (nx >= n - 1) setPlaying(false); return nx; });
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, n, setI]);
  return (
    <div className="controls">
      <button className="btn hot small" onClick={() => { if (!playing && i >= n - 1) setI(0); setPlaying(!playing); }}>{playing ? 'Pause' : i >= n - 1 ? 'Play from the start' : 'Play'}</button>
      <input type="range" min={0} max={n - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Scrub through the incident" />
      <span className="mono small">{label}</span>
    </div>
  );
}

function DecisionNote({ mk }: { mk: Marker }) {
  const d = mk.d;
  return (
    <div className={`notice${d.action === 'LEAVE' ? ' hot' : ''}`}>
      <span className="mono small">{hm(d.ts)} UTC · <Who decidedBy={d.decidedBy} model={d.model} provider={d.provider} rule={d.rule} /> · {d.clockKind ? `${d.clockKind} clock` : 'clock'}:</span> <b>{d.action}</b>{d.summary ? `. ${d.summary}` : ''}
      {d.reasons.length > 0 && <ul className="small dim" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{d.reasons.map((r, k) => <li key={k}>{r.claim} <span className="faint mono tiny">{r.evidence_ids.join(' ')}</span></li>)}</ul>}
      <div className="tiny faint mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
        {mk.vaults.length} position{mk.vaults.length === 1 ? '' : 's'}: {mk.vaults.join(', ')}
        {d.model && <> · {d.provider ? `${d.provider} ` : ''}{d.model}{d.inputTokens !== null && d.outputTokens !== null ? ` · ${d.inputTokens + d.outputTokens} tokens` : ''}{d.costUsd !== null ? ` · $${d.costUsd.toFixed(6)}` : ''}</>}
        {d.modelError && <> · model error: {d.modelError.slice(0, 100)}</>}
        {d.hash && <> · hash {d.hash}</>}
      </div>
    </div>
  );
}

export function ReplayPlayer({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ReplayPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inc, setInc] = useState(0);
  const [mk, setMk] = useState(0);
  const [zoom, setZoom] = useState<Zoom>('break');
  const [i, setI] = useState(1e9);
  const [pick, setPick] = useState<Marker | null>(null);

  useEffect(() => {
    fetch('/api/replay', { cache: 'no-store' }).then((r) => r.json()).then(setData, (e: Error) => setErr(e.message));
  }, []);

  if (err) return <div className="errbox">Replay could not load: {err}</div>;
  if (!data) return <Loading text="Loading the replay" />;
  if (!data.incidents.length) {
    return (
      <div className="player">
        <span className="badge-real">Replay of real onchain data</span>
        <Loading text="Replay data loading. No numbers are shown until the onchain record lands." />
      </div>
    );
  }
  const I: Incident = data.incidents[Math.min(inc, data.incidents.length - 1)]!;
  const m = I.markets[Math.min(mk, I.markets.length - 1)]!;
  const dec = I.id === 'resolv' ? data.decisions : null;
  const markers = markersFor(m, dec);
  const sweep = sweepFor(m, dec);
  const reset = () => { setI(1e9); setPick(null); };
  const lastMk = pick ?? [...markers].reverse().find((x) => x.action === 'LEAVE') ?? null;
  const dateLabel = I.id === 'stream' ? 'Nov 2025' : 'Mar 22 2026';

  return (
    <div className="player">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="chips">
          {data.incidents.map((x, j) => (
            <button key={x.id} className={`chip${j === inc ? ' clock' : ''}`} style={{ cursor: 'pointer', background: j === inc ? undefined : 'none' }} onClick={() => { setInc(j); setMk(0); reset(); }}>{x.short}</button>
          ))}
        </span>
        <span className="chips">
          <button className={`chip${zoom === 'break' ? ' watch' : ''}`} onClick={() => { setZoom('break'); reset(); }} style={{ cursor: 'pointer', background: 'none' }}>around the break</button>
          <button className={`chip${zoom === 'all' ? ' watch' : ''}`} onClick={() => { setZoom('all'); reset(); }} style={{ cursor: 'pointer', background: 'none' }}>whole window</button>
        </span>
      </div>
      <p style={{ margin: '0 0 14px' }}><span className="badge-real"><span className="live-dot hot" />Replay of real onchain data from {dateLabel}</span></p>
      <div className="chips" style={{ marginBottom: 16 }}>
        {I.markets.map((x, j) => (
          <button key={x.key} onClick={() => { setMk(j); reset(); }} className={`chip${j === mk ? ' watch' : ''}`} style={{ cursor: 'pointer', background: 'none', fontWeight: j === mk ? 700 : 400 }}>{x.label}</button>
        ))}
      </div>

      {sweep && m.clockOpenAt && sweep.s.ts < m.clockOpenAt && (
        <div className="callout">
          <div className="eyebrow hot-t">The sweep</div>
          <p className="callout-h">Sweep, {hmShort(sweep.s.ts)}: {m.collateral} linked to {sweep.relatedTo.join(' and ') || sweep.s.breaks.join(' and ')}. {m.collateral}&apos;s own feed showed nothing until {hmShort(m.clockOpenAt)}.</p>
          {sweep.reason && <p className="small dim" style={{ margin: 0 }}>&ldquo;{sweep.reason}&rdquo; <span className="mono tiny faint"><Who decidedBy="model" model={sweep.s.model} provider={sweep.s.provider} /></span></p>}
        </div>
      )}
      {m.fullUtilBeforeBreak && m.fullUtilAt && m.clockOpenAt && (
        <div className="callout">
          <div className="eyebrow hot-t">The lesson</div>
          <p className="callout-h">Lenders were locked at 100% borrowed {Math.round((m.clockOpenAt - m.fullUtilAt) / 3600)} hours before the price broke.</p>
          <p className="small dim" style={{ margin: 0 }}>A price gap alone would have fired far too late here: by {hm(m.clockOpenAt)} UTC there was nothing left to withdraw. That is why Lifeboat also opens a clock when a market is pinned near fully borrowed, the liquidity clock, before any price moves.</p>
        </div>
      )}

      <div className="legend">
        <span><i className="o" />oracle price</span>
        <span><i />market price</span>
        <span><i className="u" />share borrowed</span>
        <span><i className="c" />curator acts</span>
        {I.id === 'resolv' && <span><i className="d" />Lifeboat decision (tap)</span>}
      </div>
      <Chart key={I.id + m.key + zoom} m={m} zoom={zoom} i={i} setI={setI} markers={markers} sweepAt={sweep?.s.ts ?? null} onPick={setPick} />
      {lastMk && <DecisionNote mk={lastMk} />}
      <MarketSummary I={I} m={m} dec={dec} decisionsMissing={I.id === 'resolv' && !data.decisions} compact={compact} />
      {I.id === 'resolv' && <Positions dec={data.decisions} compact={compact} />}
      {!compact && I.sources.length > 0 && (
        <details className="src" style={{ marginTop: 28 }}>
          <summary>where every number in this replay comes from</summary>
          <ul>{I.sources.map((s, k) => <li key={k}>{s}</li>)}{m.priceSource && <li><span>market price:</span> {m.priceSource}</li>}{m.clockSource && <li><span>price break time:</span> {m.clockSource}</li>}</ul>
        </details>
      )}
    </div>
  );
}

function MarketSummary({ I, m, dec, decisionsMissing, compact }: { I: Incident; m: ReplayMarket; dec: DecisionsView | null; decisionsMissing: boolean; compact: boolean }) {
  const atClock = m.clockOpenAt ? [...m.points].reverse().find((p) => p.ts <= m.clockOpenAt!) : null;
  const pos = dec?.positions.filter((p) => p.marketId.toLowerCase() === m.marketId.toLowerCase()) ?? [];
  const left = pos.map((p) => p.left).filter((x): x is NonNullable<PositionView['left']> => !!x).sort((a, b) => a.ts - b.ts)[0] ?? null;
  const curFirst = m.vaults.map((v) => v.firstAction).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.ts - b.ts)[0] ?? null;
  const vaults = compact ? m.vaults.slice(0, 5) : m.vaults;
  // Whole minutes elapsed (02:27:23 to 03:09:59 is 42 min), matching the README and video.
  const fullMin = m.clockOpenAt && m.fullUtilAt ? Math.floor((m.fullUtilAt - m.clockOpenAt) / 60) : null;
  return (
    <div className="split" style={{ marginTop: 36 }}>
      <div>
        {I.id === 'resolv' && (
          <>
            <div className="eyebrow">Lifeboat</div>
            {decisionsMissing ? (
              <p className="notice">Dolphin replay run pending. The decision points for March 22 appear here once the open model has been run over the day, minute by minute, on the evidence available at each moment.</p>
            ) : left ? (
              <>
                <div className="bignum hot-t">{hmShort(left.ts)}</div>
                <p className="dim" style={{ marginTop: 6 }}>
                  Lifeboat decided at <b className="mono">{hmShort(left.ts)}</b> (<Who decidedBy={left.decidedBy} model={left.model} provider={left.provider} rule={left.rule} />, {left.clockKind ?? 'gap'} clock){left.exitFilledAt ? <>, exit filled at <b className="mono">{hmShort(left.exitFilledAt)}</b> with <b>{usd(left.withdrawableAtFill)}</b> withdrawable in the market</> : ', exit not filled in the window'}.
                </p>
                {left.notice && (
                  <div className="notice">
                    <div className="tiny faint mono" style={{ marginBottom: 4 }}>Notice written by SERV Reasoning ({left.notice.model ?? 'model not recorded'})</div>
                    {left.notice.text}
                  </div>
                )}
                <p className="small">{curFirst ? <>The first curator move on this market came at <b className="mono">{hmShort(curFirst.ts)}</b>{left.exitFilledAt ? `, ${span((curFirst.ts - left.exitFilledAt) / 60)} ${curFirst.ts >= left.exitFilledAt ? 'after' : 'before'} Lifeboat was out` : ''}.</> : 'No curator moved on this market in the window.'}</p>
              </>
            ) : (
              <p className="small dim">The replay run did not leave this market.</p>
            )}
          </>
        )}
        <div className="eyebrow" style={{ marginTop: I.id === 'resolv' ? 26 : 0 }}>Price broke</div>
        <div className="bignum">{m.clockOpenAt ? hmShort(m.clockOpenAt) : 'unavailable'}</div>
        <p className="small dim">UTC{m.clockOpenAt ? `, ${hm(m.clockOpenAt).split(' ').slice(0, 2).join(' ')}` : ''}. Oracle {m.clockGap !== null ? pct(m.clockGap * 100, 1) : ''} above the market. Cash left in the market then: {usd(atClock?.withdrawable ?? null)}.</p>
        <div className="eyebrow" style={{ marginTop: 22 }}>Fully borrowed</div>
        <div className="bignum">{fullMin === null ? 'unavailable' : fullMin >= 0 ? `+${span(fullMin)}` : span(fullMin)}</div>
        <p className="small dim">{m.fullUtilAt ? `${fullMin !== null && fullMin < 0 ? 'before the price broke, at ' : fullMin !== null ? 'after the price broke, at ' : ''}${hm(m.fullUtilAt)} UTC. From then on no lender in this market could withdraw.` : ''}</p>
      </div>
      <div className="events">
        <div className="eyebrow">When each curator actually acted</div>
        {vaults.length === 0 && <p className="small dim">No curated vault in this file had money in this market.</p>}
        {vaults.map((v) => (
          <div key={v.address} className="txline">
            <span className="when">{v.firstAction ? (Math.abs(v.firstAction.ts - (m.clockOpenAt ?? v.firstAction.ts)) > 12 * 3600 ? hm(v.firstAction.ts) : hmShort(v.firstAction.ts)) : 'never'}</span>
            <span>
              <b style={{ fontWeight: 600 }}>{v.name}</b>{v.curator ? <span className="faint"> · {v.curator}</span> : null}<br />
              <span className="small dim">{v.firstAction ? `${v.firstAction.label}, ${after(m.clockOpenAt, v.firstAction.ts, 'the price break')}` : 'no protective action in the window'}</span>
              {v.supplyAtDivergence !== null && v.supplyEnd !== null && Math.abs(v.supplyEnd - v.supplyAtDivergence) > 1000 && (
                <><br /><span className="small hot-t">Vault money here: {usd(v.supplyAtDivergence)} at the break, {usd(v.supplyEnd)} at the end</span></>
              )}
            </span>
            {v.firstAction ? <a href={v.firstAction.explorer} target="_blank" rel="noreferrer">{short(v.firstAction.tx, 4)}</a> : <span />}
          </div>
        ))}
        {compact && m.vaults.length > vaults.length && <p className="small dim" style={{ marginTop: 10 }}>and {m.vaults.length - vaults.length} more on the full replay page.</p>}
      </div>
    </div>
  );
}

function Positions({ dec, compact }: { dec: DecisionsView | null; compact: boolean }) {
  if (!dec) return null;
  const rows = [...dec.positions].sort((a, b) => (b.supplyEnd ?? 0) - (a.supplyEnd ?? 0));
  return (
    <div style={{ marginTop: 48 }}>
      <h3 className="display" style={{ marginBottom: 6 }}>Every exposed position</h3>
      <p className="small dim" style={{ margin: '0 0 6px', maxWidth: '72ch' }}>A $1,000 depositor in each vault (illustrative); withdrawable amounts are onchain. Minutes count from the first price break at {dec.firstBreak ? `${hmShort(dec.firstBreak)} UTC` : 'the first break'}.</p>
      <p className="tiny faint mono" style={{ margin: '0 0 14px' }}>Calls made by {dec.models.length ? dec.models.join(', ') : 'rules only'}{dec.providers.length ? ` (${dec.providers.join(', ')})` : ''}{dec.providers.includes('stand-in') && <span className="chip standin">stand-in model (not Dolphin)</span>}{dec.modelCalls !== null ? ` · ${dec.modelCalls} model calls` : ''}{dec.cadence ? ` · ${dec.cadence}` : ''}</p>
      <div className="ptable">
        <div className="prow phead2"><span>Vault</span><span>Collateral</span><span>Lifeboat out</span><span>Curator first move</span><span>Vault money stuck at the end</span></div>
        {rows.slice(0, compact ? 10 : rows.length).map((p) => (
          <div className="prow" key={p.vaultAddress + p.marketId}>
            <span><b>{p.vaultName}</b><span className="faint small"> · {p.chain}{p.curator ? ` · ${p.curator}` : ''}</span></span>
            <span className="mono">{p.collateral}{p.left?.clockKind === 'related' && <span className="tiny hot-t"> sweep</span>}</span>
            <span className="mono">
              <span className="plabel">Lifeboat out </span>
              {p.left ? <>{p.minFilled !== null ? `+${p.minFilled} min` : p.minDecision !== null ? `decided +${p.minDecision} min` : hmShort(p.left.ts)}<span className="tiny faint"> {p.left.exitFilledAt ? hmShort(p.left.exitFilledAt) : 'not filled'} · <Who decidedBy={p.left.decidedBy} model={p.left.model} provider={p.left.provider} rule={p.left.rule} /></span></> : 'stayed'}
            </span>
            <span className="mono">
              <span className="plabel">Curator first move </span>
              {p.curatorFirst ? <a href={p.curatorFirst.explorer} target="_blank" rel="noreferrer">{p.curatorMin !== null ? `${p.curatorMin >= 0 ? '+' : ''}${span(p.curatorMin)}` : hmShort(p.curatorFirst.ts)}</a> : 'none'}
            </span>
            <span className={`mono${(p.supplyEnd ?? 0) > 1000 ? ' hot-t' : ''}`}><span className="plabel">Stuck at the end </span>{usd(p.supplyEnd)}</span>
          </div>
        ))}
      </div>
      {dec.note && !compact && <p className="tiny faint" style={{ marginTop: 12, maxWidth: '80ch' }}>{dec.note}</p>}
    </div>
  );
}
