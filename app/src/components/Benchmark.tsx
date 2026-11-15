'use client';
import { useEffect, useState } from 'react';
import { Loading } from './Board';

type J = any;
const ARMS = ['dolphin', 'lifeboat', 'frontier'] as const;
const ARM_NAME: Record<string, string> = { dolphin: 'Dolphin alone', lifeboat: 'Lifeboat as shipped', frontier: 'Frontier model alone' };
const GROUPS: Record<string, string> = {
  march22_exposed: 'March 22, exposed positions during the break (right answer: leave)',
  stream_exposed: 'Stream, November 2025, exposed positions (right answer: leave)',
  march22_before_break: 'March 22, the same markets before the break (right answer: stay)',
  live_calm: 'Live calm markets today (right answer: stay)',
  live_benign_gap: 'Live markets with a small harmless gap (right answer: stay)',
};
const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`) : 'not recorded');
const Act = ({ a }: { a: string | null | undefined }) => <b className={a === 'LEAVE' ? 'hot-t' : a === 'STAY' ? 'sea-t' : ''}>{a ?? 'none'}</b>;

export function Benchmark() {
  const [d, setD] = useState<J | null>(null);
  useEffect(() => { fetch('/api/benchmark').then((r) => r.json()).then(setD, () => setD({ available: false })); }, []);
  if (!d) return <Loading text="Loading the benchmark" />;
  if (!d.available) return <p className="dim">The benchmark results have not been published yet.</p>;
  const S = d.summary ?? {};
  const cases: J[] = Array.isArray(d.cases) ? d.cases : [];
  const groups: Record<string, number> = {};
  for (const c of cases) groups[c.group] = (groups[c.group] ?? 0) + 1;
  const ref = S.dolphin ?? S.lifeboat ?? S.frontier ?? {};
  const total = ref.total ?? cases.length;
  const leaveCases = ref.leaveCases ?? cases.filter((c) => c.truth === 'LEAVE').length;
  const calmCases = ref.calmCases ?? total - leaveCases;
  const dc = S.dolphin?.costPerDecisionUsd, fc = S.frontier?.costPerDecisionUsd;
  const ratio = typeof dc === 'number' && typeof fc === 'number' && dc > 0 ? Math.round(fc / dc) : null;

  return (
    <div>
      <p className="lede" style={{ marginBottom: 28 }}>{d.question}</p>
      <div className="ptable btable">
        <div className="prow phead2"><span>Arm</span><span>Correct</span><span>False alarms</span><span>Leave caught</span><span>Positions out</span><span>Median min to leave</span><span>Bad citations</span><span>Cost per decision</span></div>
        {ARMS.filter((a) => S[a]).map((a) => {
          const s = S[a];
          return (
            <div className="prow" key={a}>
              <span><b>{ARM_NAME[a]}</b><br /><span className="tiny faint">{d.arms?.[a]}</span></span>
              <span className="mono"><span className="plabel">Correct </span><b>{s.correct}</b> / {s.total}</span>
              <span className="mono"><span className="plabel">False alarms on calm cases </span>{s.falseAlarms} / {s.calmCases}</span>
              <span className="mono"><span className="plabel">Leave caught </span>{s.leaveCaught} / {s.leaveCases}</span>
              <span className="mono"><span className="plabel">Positions that left </span>{s.positionsLeft} / {s.positions}</span>
              <span className="mono"><span className="plabel">Median minutes to leave </span>{s.medianMinutesToLeave ?? 'none'}</span>
              <span className="mono"><span className="plabel">Invalid citations </span>{s.invalidCitations}{s.errors ? ` · ${s.errors} errors` : ''}</span>
              <span className="mono"><span className="plabel">Cost per decision </span>{money(s.costPerDecisionUsd)}</span>
            </div>
          );
        })}
      </div>
      <p style={{ marginTop: 22 }}>A bot that always says LEAVE would get {leaveCases} of {total} and raise {calmCases} false alarms.</p>
      {ratio !== null && <p className="callout-h" style={{ fontSize: 'clamp(22px,2.6vw,30px)' }}>Dolphin {money(dc)} per decision vs frontier {money(fc)}: {ratio} times cheaper.</p>}
      <p className="small dim" style={{ maxWidth: '76ch' }}>The Lifeboat arm&apos;s cost includes the SERV second opinion, which the benchmark ran on every calm case because it forces a check; live, it only runs when a real clock opens.</p>
      {d.hardRules && <p className="small dim" style={{ maxWidth: '76ch' }}>{d.hardRules}</p>}

      <h3 className="display" style={{ margin: '48px 0 12px' }}>The {total} cases</h3>
      {d.truth && <p className="small dim" style={{ maxWidth: '76ch' }}>{d.truth}</p>}
      <div className="ptable">
        {Object.entries(groups).map(([g, n]) => (
          <div className="prow grow" key={g}><span>{GROUPS[g] ?? g}</span><span className="mono">{n}</span></div>
        ))}
      </div>

      <h3 className="display" style={{ margin: '48px 0 12px' }}>Misses, shown openly</h3>
      {ARMS.filter((a) => S[a]).map((a) => {
        const misses: J[] = Array.isArray(S[a].misses) ? S[a].misses : [];
        return (
          <div key={a} style={{ marginBottom: 26 }}>
            <div className="eyebrow">{ARM_NAME[a]}: {misses.length} miss{misses.length === 1 ? '' : 'es'}</div>
            {misses.map((m, k) => (
              <div className="txline miss" key={k}>
                <span className="mono tiny" style={{ wordBreak: 'break-word' }}>{m.id}</span>
                <span className="small">should be <b>{m.truth}</b>, got <Act a={m.got} /> · {m.by === 'rule' ? `rule${m.rule ? ` (${String(m.rule).replace(/_/g, ' ')})` : ''}` : m.by ?? 'model'}{m.error ? <span className="hot-t"> · error: {String(m.error).slice(0, 100)}</span> : null}{m.summary ? <span className="faint"><br />{String(m.summary).slice(0, 240)}</span> : null}</span>
                <span />
              </div>
            ))}
          </div>
        );
      })}

      <details className="src" style={{ marginTop: 10 }}>
        <summary>every case with all three answers ({cases.length})</summary>
        <div className="ptable ctable" style={{ marginTop: 12 }}>
          <div className="prow phead2"><span>Case</span><span>Truth</span><span>Dolphin</span><span>Lifeboat</span><span>Frontier</span></div>
          {cases.map((c) => (
            <div className="prow" key={c.id}>
              <span className="mono tiny" style={{ wordBreak: 'break-word' }}>{c.id}{typeof c.minutesFromBreak === 'number' ? ` (+${c.minutesFromBreak} min)` : ''}</span>
              <span className="mono small"><span className="plabel">Truth </span>{c.truth}</span>
              {ARMS.map((a) => (
                <span key={a} className="mono small"><span className="plabel">{ARM_NAME[a]} </span><Act a={c[a]?.action} />{c[a]?.decidedBy === 'rule' ? <span className="tiny faint"> rule</span> : null}{a === 'lifeboat' && c.secondOpinion?.applied ? <span className="tiny faint"> 2nd opinion</span> : null}</span>
              ))}
            </div>
          ))}
        </div>
      </details>
      {d.ranAt && <p className="tiny faint mono" style={{ marginTop: 18 }}>Run {String(d.ranAt).slice(0, 16).replace('T', ' ')} UTC on real onchain cases and live markets.</p>}
    </div>
  );
}
