'use client';
import { useEffect, useState } from 'react';
import { ago, utcDate } from '@/lib/format';
import { Who } from './Who';

type J = any;
interface Status { askChecks?: number; configured: boolean; heartbeat: J; totals: J; latestSweep: J; sweeps: J[]; now: number }

const tsOf = (v: unknown): number | null => {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? Math.floor(t / 1000) : null; }
  return null;
};
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v: unknown): number | null => (Array.isArray(v) ? v.length : n(v));
const money = (v: number | null) => (v === null ? 'unavailable' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

function useStatus(sweeps = 1) {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const go = () => fetch(`/api/status?sweeps=${sweeps}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => alive && setS(j), (e: Error) => alive && setErr(e.message));
    go();
    const t = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [sweeps]);
  return { s, err };
}

export function WatcherLine() {
  const { s, err } = useStatus(1);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);
  if (err) return null;
  if (!s) return <div className="live-strip watcher"><span className="live-dot" />Reading the watcher…</div>;
  if (!s.configured || !s.heartbeat) return <div className="live-strip watcher"><span className="live-dot" style={{ background: 'var(--fg3)', animation: 'none' }} />The minute watcher has not reported yet. Its heartbeat shows here once it runs.{s.askChecks ? <> · <b>{s.askChecks}</b> live check{s.askChecks === 1 ? '' : 's'} by Dolphin</> : null}</div>;
  const h = s.heartbeat;
  const at = tsOf(h.at);
  const late = at !== null && now - at > 180;
  const clocks = count(h.openClocks) ?? 0;
  return (
    <div className="live-strip watcher">
      <span className={`live-dot${clocks ? ' hot' : ''}`} style={late ? { background: 'var(--fg3)', animation: 'none' } : undefined} />
      <span>
        Watcher last ran <b>{at ? ago(at, now) : 'at an unknown time'}</b> · <b>{count(h.markets) ?? 'unknown'}</b> markets guarded · <span className={clocks ? 'k' : ''}>{clocks} clock{clocks === 1 ? '' : 's'} open</span> · <b>{money(n(s.totals?.costUsd))}</b> spent on the model so far{s.askChecks ? <> · <b>{s.askChecks}</b> live check{s.askChecks === 1 ? '' : 's'} by Dolphin</> : null}
      </span>
    </div>
  );
}

export function WatcherProof() {
  const { s, err } = useStatus(5);
  if (err) return <div className="errbox">Watcher status unavailable: {err}</div>;
  if (!s) return null;
  if (!s.configured) return <p className="dim">The minute watcher has not written its state yet. Totals and sweeps appear here once it runs.</p>;
  const t = s.totals ?? {};
  const h = s.heartbeat ?? {};
  const at = tsOf(h.at);
  const errs = Array.isArray(h.errors) ? h.errors : [];
  return (
    <div>
      <div className="stat-row">
        <div><div className="bignum">{n(t.cycles) ?? 'unavailable'}</div><div className="small dim">watch cycles run</div></div>
        <div><div className="bignum">{n(t.dolphinCalls) ?? 'unavailable'}</div><div className="small dim">model calls</div></div>
        <div><div className="bignum">{n(t.inputTokens) !== null && n(t.outputTokens) !== null ? (t.inputTokens + t.outputTokens).toLocaleString('en-US') : 'unavailable'}</div><div className="small dim">tokens read and written</div></div>
        <div><div className="bignum">{money(n(t.costUsd))}</div><div className="small dim">total model cost</div></div>
      </div>
      <p className="small dim">Last heartbeat {at ? `${utcDate(at)} (${ago(at)})` : 'unknown'}: {count(h.accounts) ?? 'unknown'} accounts, {count(h.markets) ?? 'unknown'} markets, {count(h.openClocks) ?? 0} clocks open, {count(h.decisions) ?? 0} decisions this cycle{errs.length ? `, ${errs.length} errors: ${errs.slice(0, 2).map(String).join('; ')}` : ''}.</p>
      <h3 className="display" style={{ margin: '40px 0 8px' }}>Latest sweeps</h3>
      <p className="small dim" style={{ maxWidth: '70ch' }}>Each sweep is one model call that reads every guarded market next to every live break on the board, looking for links a price feed cannot show: same issuer, wrapped or tranche tokens.</p>
      {s.sweeps.length === 0 && <p className="dim">No sweeps yet. A sweep runs when something on the board breaks.</p>}
      {s.sweeps.map((w: J, k: number) => {
        const wt = tsOf(w.ts ?? w.at);
        const flags: J[] = Array.isArray(w.flags) ? w.flags : [];
        return (
          <div className="rec" key={k}>
            <div><div className="act" style={{ fontSize: 26 }}>{flags.length} flag{flags.length === 1 ? '' : 's'}</div><div className="tiny faint mono"><Who decidedBy="model" model={w.model?.model ?? null} provider={w.model?.provider ?? null} /></div></div>
            <div>
              <div>Breaks: {Array.isArray(w.breaks) && w.breaks.length ? w.breaks.join(', ') : 'none'}</div>
              {flags.map((f: J, j: number) => <div key={j} className="small dim">Linked {Array.isArray(f.related_to) ? f.related_to.join(', ') : ''}: {f.reason}</div>)}
              <div className="meta"><span>{wt ? `${utcDate(wt)} (${ago(wt)})` : 'time unknown'}</span>{w.model?.costUsd != null && <span>{money(w.model.costUsd)}</span>}{w.error && <span className="hot-t">error: {String(w.error).slice(0, 120)}</span>}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
