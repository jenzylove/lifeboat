'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayMarket, ReplayView } from '@/lib/replayView';
import { price, pct, ratioPct, usd, short } from '@/lib/format';
import { Loading } from './Board';

const W = 1000, H = 400, PL = 52, PR = 16, PT = 22, PRICE_B = 236, UT = 286, UB = 362;

const hm = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const hmShort = (t: number) => { const d = new Date(t * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const after = (a: number | null, b: number) => {
  if (a === null) return '';
  const m = Math.round((b - a) / 60);
  const abs = Math.abs(m);
  const span = abs >= 120 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return m === 0 ? 'as the clock opened' : `${span} ${m > 0 ? 'after' : 'before'} the clock`;
};

type Zoom = 'break' | 'all';

function Chart({ m, zoom, i, setI }: { m: ReplayMarket; zoom: Zoom; i: number; setI: React.Dispatch<React.SetStateAction<number>> }) {
  const pts = useMemo(() => {
    if (zoom === 'all' || !m.clockOpenAt) return m.points;
    const lo = m.clockOpenAt - 3 * 3600, hi = m.clockOpenAt + 6 * 3600;
    return m.points.filter((p) => p.ts >= lo && p.ts <= hi);
  }, [m, zoom]);
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
    return { t0, t1, x, y, yu, line, area, gapArea, ticks, tticks };
  }, [pts, n]);
  const k = Math.min(i, n - 1);
  const cur = pts[k]!;
  const inView = (t: number | null) => t !== null && t >= geo.t0 && t <= geo.t1;
  const shown = (t: number | null) => inView(t) && t! <= cur.ts;

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Oracle price versus market price for ${m.label}`}
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const t = geo.t0 + (((e.clientX - r.left) / r.width) * W - PL) / (W - PL - PR) * (geo.t1 - geo.t0);
          let best = 0; for (let j = 0; j < n; j++) if (Math.abs(pts[j]!.ts - t) < Math.abs(pts[best]!.ts - t)) best = j;
          setI(best);
        }}>
        {geo.ticks.map((v) => (
          <g key={v}><line className="grid" x1={PL} x2={W - PR} y1={geo.y(v)} y2={geo.y(v)} /><text className="ax" x={PL - 8} y={geo.y(v) + 4} textAnchor="end">{v.toFixed(2)}</text></g>
        ))}
        {geo.tticks.map((t) => <text key={t} className="ax" x={geo.x(t)} y={H - 6} textAnchor="middle">{zoom === 'all' ? hm(t) : hmShort(t)}</text>)}
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
        {shown(m.clockOpenAt) && (
          <g><line className="mk-clock" x1={geo.x(m.clockOpenAt!)} x2={geo.x(m.clockOpenAt!)} y1={PT - 8} y2={UB} /><text className="mk-lbl" x={geo.x(m.clockOpenAt!) + 5} y={PT} style={{ fill: 'var(--hot-text)' }}>clock opens {hmShort(m.clockOpenAt!)}</text></g>
        )}
        {shown(m.fullUtilAt) && (
          <g><line className="mk-clock" x1={geo.x(m.fullUtilAt!)} x2={geo.x(m.fullUtilAt!)} y1={UT} y2={UB} style={{ stroke: 'var(--sea)' }} /><text className="mk-lbl" x={geo.x(m.fullUtilAt!) + 5} y={UT + 12}>fully borrowed {hmShort(m.fullUtilAt!)}</text></g>
        )}
        {m.vaults.filter((v) => v.firstAction && shown(v.firstAction.ts)).map((v, j) => (
          <a key={v.address} href={v.firstAction!.explorer} target="_blank" rel="noreferrer">
            <circle className="mk-cur" cx={geo.x(v.firstAction!.ts)} cy={PRICE_B + 16 + (j % 2) * 10} r={4.5}><title>{`${hm(v.firstAction!.ts)} ${v.name}: ${v.firstAction!.label}`}</title></circle>
          </a>
        ))}
        {m.decisions.filter((d) => shown(d.ts)).map((d, j) => {
          const p = [...pts].reverse().find((q) => q.ts <= d.ts);
          const yy = p?.marketPrice != null ? geo.y(p.marketPrice) : PT + 10;
          return <circle key={j} className="mk-dec" cx={geo.x(d.ts)} cy={yy} r={d.action === 'LEAVE' ? 7 : 3.5}><title>{`${hm(d.ts)} ${d.by}: ${d.action}`}</title></circle>;
        })}
        <line className="cursor" x1={geo.x(cur.ts)} x2={geo.x(cur.ts)} y1={PT - 8} y2={UB} />
      </svg>
      <Readout m={m} cur={cur} />
      <Controls n={n} i={k} setI={setI} label={hm(cur.ts) + ' UTC'} />
    </>
  );
}

function Readout({ m, cur }: { m: ReplayMarket; cur: ReplayMarket['points'][number] }) {
  const gap = cur.oraclePrice !== null && cur.marketPrice !== null && cur.oraclePrice > 0 ? ((cur.oraclePrice - cur.marketPrice) / cur.oraclePrice) * 100 : null;
  const lastDec = m.decisions.filter((d) => d.ts <= cur.ts).pop();
  return (
    <>
      <div className="readout">
        <div><span className="l">Oracle said</span><span className="v hot-t">{price(cur.oraclePrice)}</span></div>
        <div><span className="l">Market said</span><span className="v">{price(cur.marketPrice)}</span></div>
        <div><span className="l">Gap</span><span className="v">{pct(gap, 1)}</span></div>
        <div><span className="l">Borrowed / cash left</span><span className="v">{ratioPct(cur.utilization)} · {usd(cur.withdrawable)}</span></div>
      </div>
      {lastDec && (
        <p className={`notice${lastDec.action === 'LEAVE' ? ' hot' : ''}`}>
          <span className="mono small">{hm(lastDec.ts)} UTC · {lastDec.by}{lastDec.model ? ` (${lastDec.model})` : ''}:</span> <b>{lastDec.action}</b>{lastDec.summary ? `. ${lastDec.summary}` : ''}
        </p>
      )}
    </>
  );
}

function Controls({ n, i, setI, label }: { n: number; i: number; setI: React.Dispatch<React.SetStateAction<number>>; label: string }) {
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const msPer = 16000 / n; // whole range in about 16 s
    const step = (t: number) => {
      if (t - last >= msPer) {
        const adv = Math.floor((t - last) / msPer); last = t;
        setI((x: number) => { const nx = Math.min(n - 1, x + adv); if (nx >= n - 1) setPlaying(false); return nx; });
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, n, setI]);
  return (
    <div className="controls">
      <button className="btn hot small" onClick={() => { if (!playing && i >= n - 1) setI(0); setPlaying(!playing); }}>{playing ? 'Pause' : i >= n - 1 ? 'Play from the start' : 'Play'}</button>
      <input type="range" min={0} max={n - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Scrub through the day" />
      <span className="mono small">{label}</span>
    </div>
  );
}

export function ReplayPlayer({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<ReplayView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mk, setMk] = useState(0);
  const [zoom, setZoom] = useState<Zoom>('break');
  const [i, setI] = useState(1e9);

  useEffect(() => {
    fetch('/api/replay', { cache: 'no-store' }).then((r) => r.json()).then((j) => setView(j.view), (e: Error) => setErr(e.message));
  }, []);

  if (err) return <div className="errbox">Replay could not load: {err}</div>;
  if (!view) return <Loading text="Loading the replay" />;
  if (!view.ready) {
    return (
      <div className="player">
        <span className="badge-real">Replay of real onchain data from Mar 22 2026</span>
        <Loading text="Replay data loading. The block by block record of March 22 is still being assembled; this player fills in as soon as it lands. No numbers are shown until then." />
      </div>
    );
  }
  const m = view.markets[Math.min(mk, view.markets.length - 1)]!;

  return (
    <div className="player">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="badge-real"><span className="live-dot hot" />Replay of real onchain data from Mar 22 2026</span>
        <span className="chips">
          <button className={`chip${zoom === 'break' ? ' clock' : ''}`} onClick={() => { setZoom('break'); setI(1e9); }} style={{ cursor: 'pointer', background: zoom === 'break' ? undefined : 'none' }}>around the break</button>
          <button className={`chip${zoom === 'all' ? ' clock' : ''}`} onClick={() => { setZoom('all'); setI(1e9); }} style={{ cursor: 'pointer', background: zoom === 'all' ? undefined : 'none' }}>whole window</button>
        </span>
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        {view.markets.map((x, j) => (
          <button key={x.key} onClick={() => { setMk(j); setI(1e9); }} className={`chip${j === mk ? ' watch' : ''}`} style={{ cursor: 'pointer', background: 'none', fontWeight: j === mk ? 700 : 400 }}>{x.label}</button>
        ))}
      </div>
      <div className="legend">
        <span><i className="o" />oracle price</span>
        <span><i />market price</span>
        <span><i className="u" />share borrowed</span>
        <span><i className="c" />curator acts</span>
        <span><i className="d" />Lifeboat decision</span>
      </div>
      <Chart key={m.key + zoom} m={m} zoom={zoom} i={i} setI={setI} />
      <ReplaySummary m={m} compact={compact} />
      {!compact && view.sources.length > 0 && (
        <details className="src" style={{ marginTop: 28 }}>
          <summary>where every number in this replay comes from</summary>
          <ul>{view.sources.map((s, k) => <li key={k}>{s}</li>)}{m.priceSource && <li><span>market price:</span> {m.priceSource}</li>}{m.clockSource && <li><span>clock time:</span> {m.clockSource}</li>}</ul>
        </details>
      )}
    </div>
  );
}

function ReplaySummary({ m, compact }: { m: ReplayMarket; compact: boolean }) {
  const toFull = m.clockOpenAt && m.fullUtilAt ? Math.round((m.fullUtilAt - m.clockOpenAt) / 60) : null;
  const atClock = m.clockOpenAt ? [...m.points].reverse().find((p) => p.ts <= m.clockOpenAt!) : null;
  const vaults = compact ? m.vaults.slice(0, 6) : m.vaults;
  return (
    <div className="split" style={{ marginTop: 40 }}>
      <div>
        <div className="eyebrow">The clock opened</div>
        <div className="bignum hot-t">{m.clockOpenAt ? hmShort(m.clockOpenAt) : 'unavailable'}</div>
        <p className="small dim">UTC{m.clockOpenAt ? `, ${hm(m.clockOpenAt).split(' ').slice(0, 2).join(' ')}` : ''}. Oracle {m.clockGap !== null ? pct(m.clockGap * 100, 1) : ''} above the market. Cash left in the market then: {usd(atClock?.withdrawable ?? null)}.</p>
        <div className="eyebrow" style={{ marginTop: 26 }}>Fully borrowed</div>
        <div className="bignum">{toFull !== null ? `${toFull} min` : 'unavailable'}</div>
        <p className="small dim">{toFull !== null ? `after the clock opened (${hmShort(m.fullUtilAt!)} UTC). From then on no lender in this market could withdraw.` : ''}</p>
        <div className="eyebrow" style={{ marginTop: 26 }}>Lifeboat would have left at</div>
        {m.leaveAt ? (
          <>
            <div className="bignum hot-t">{hmShort(m.leaveAt)}</div>
            <p className="small dim">{after(m.clockOpenAt, m.leaveAt)}, with {usd(m.withdrawableAtLeave)} still withdrawable in this market.</p>
          </>
        ) : (
          <p className="small dim">Decision points for this market are being computed from the evidence available at each minute. They appear here, marked as a Dolphin decision or a rule, once they land.</p>
        )}
      </div>
      <div className="events">
        <div className="eyebrow">When each curator actually acted</div>
        {vaults.length === 0 && <p className="small dim">No curated vault in this file was exposed to this market.</p>}
        {vaults.map((v) => (
          <div key={v.address} className="txline">
            <span className="when">{v.firstAction ? hmShort(v.firstAction.ts) : 'never'}</span>
            <span>
              <b style={{ fontWeight: 600 }}>{v.name}</b>{v.curator ? <span className="faint"> · {v.curator}</span> : null}<br />
              <span className="small dim">{v.firstAction ? `${v.firstAction.label}, ${after(m.clockOpenAt, v.firstAction.ts)}` : 'no protective action in the window'}</span>
              {v.supplyAtDivergence !== null && v.supplyEnd !== null && Math.abs(v.supplyEnd - v.supplyAtDivergence) > 1000 && (
                <><br /><span className="small hot-t">Vault money in this market: {usd(v.supplyAtDivergence)} at the clock, {usd(v.supplyEnd)} at the end</span></>
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
