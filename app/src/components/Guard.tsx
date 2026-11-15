'use client';
import { useEffect, useState } from 'react';

type J = any;
interface Item { text: string; kind: string; verdict: string; by: string | null; model: string | null }

function norm(g: J): { checked: number; passed: number; blocked: number; unscreened: number; results: Item[] } | null {
  if (!g || typeof g !== 'object') return null;
  const results: Item[] = (Array.isArray(g.results) ? g.results : []).map((x: J) => ({ text: String(x.text ?? ''), kind: String(x.kind ?? 'text'), verdict: String(x.verdict ?? 'unscreened'), by: x.by ?? null, model: x.model ?? null }));
  const n = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  return {
    checked: n(g.checked, results.length),
    passed: n(g.passed, results.filter((x) => x.verdict === 'pass').length),
    blocked: n(g.blocked, results.filter((x) => x.verdict === 'blocked').length),
    unscreened: n(g.unscreened, results.filter((x) => x.verdict === 'unscreened').length),
    results,
  };
}

const byWords = (b: string | null) => (b === 'serv_prompt_guard' ? 'PromptGuard' : b === 'serv_model' ? 'SERV model' : b ?? '');

/** One line summary of the SERV PromptGuard screen on a record, with each screened text one tap away. */
export function GuardLine({ guard, compact = false }: { guard: J; compact?: boolean }) {
  const g = norm(guard);
  if (!g) return null;
  if (g.checked === 0 && !g.results.length) return <p className="tiny faint mono" style={{ margin: '8px 0 0' }}>No outside text in this record, so nothing needed screening by SERV PromptGuard.</p>;
  return (
    <details className="src guard">
      <summary>
        <span className={compact ? 'tiny' : 'small'}>Screened by SERV PromptGuard before Dolphin read it: {g.checked} outside text{g.checked === 1 ? '' : 's'}, {g.passed} passed, <span className={g.blocked ? 'hot-t' : ''}>{g.blocked} blocked</span>, {g.unscreened} withheld</span>
      </summary>
      <ul>
        {g.results.map((r, k) => (
          <li key={k} className={r.verdict === 'blocked' ? 'g-blocked' : r.verdict === 'unscreened' ? 'g-withheld' : ''}>
            <span>{r.kind} · {r.verdict === 'unscreened' ? 'withheld' : r.verdict}{r.by ? ` by ${byWords(r.by)}` : ''}:</span> {r.text.length > 220 ? `${r.text.slice(0, 220)}…` : r.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

function GuardRows({ rows }: { rows: J[] }) {
  return (
    <div className="ptable gtable">
      <div className="prow phead2"><span>Text</span><span>Kind</span><span>Expected</span><span>Verdict</span><span>By</span></div>
      {rows.map((r, k) => (
        <div className="prow" key={k}>
          <span style={{ wordBreak: 'break-word' }}>{r.text}</span>
          <span className="mono small"><span className="plabel">Kind </span>{r.kind}</span>
          <span className="mono small"><span className="plabel">Expected </span>{r.expected}</span>
          <span className={`mono small${r.verdict === 'blocked' ? ' hot-t' : ''}`}><span className="plabel">Verdict </span><b>{r.verdict === 'unscreened' ? 'withheld' : r.verdict}</b>{r.correct === false ? ' (miss)' : ''}</span>
          <span className="mono tiny"><span className="plabel">By </span>{r.by ? byWords(r.by) : r.verdict === 'pass' ? 'passed' : ''}{r.model ? ` · ${r.model}` : ''}{r.error ? ` · ${String(r.error).slice(0, 80)}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** The real PromptGuard evidence run from data/guard-check.json: headline numbers, misses shown openly, every row one tap away. */
export function GuardCheck({ showAll = false }: { showAll?: boolean }) {
  const [d, setD] = useState<J | null>(null);
  useEffect(() => { fetch('/api/guard-check').then((r) => r.json()).then(setD, () => setD({ available: false })); }, []);
  if (!d) return null;
  if (!d.available) return <p className="dim">The PromptGuard evidence run has not been published yet.</p>;
  const rows: J[] = Array.isArray(d.rows) ? d.rows : [];
  const misses: J[] = Array.isArray(d.misses) ? d.misses : rows.filter((r) => r.correct === false);
  const attacks = d.attacks ?? rows.filter((r) => r.expected === 'blocked').length;
  const honest = d.honest ?? rows.filter((r) => r.expected === 'pass').length;
  const blocked = d.attacksBlocked ?? rows.filter((r) => r.expected === 'blocked' && r.verdict === 'blocked').length;
  const passed = d.honestPassed ?? rows.filter((r) => r.expected === 'pass' && r.verdict === 'pass').length;
  return (
    <div>
      <div className="stat-row">
        <div><div className="bignum">{blocked}<span className="dim" style={{ fontSize: '.45em' }}> / {attacks}</span></div><div className="small dim">planted attacks blocked</div></div>
        <div><div className="bignum">{passed}<span className="dim" style={{ fontSize: '.45em' }}> / {honest}</span></div><div className="small dim">honest texts passed</div></div>
      </div>
      <p className="small" style={{ maxWidth: '72ch' }}>
        {blocked} of {attacks} attacks blocked, {passed} of {honest} honest texts passed.{' '}
        <span className="dim">Blocked by PromptGuard: {d.byPromptGuard ?? 'not recorded'}; by the SERV model: {d.byServModel ?? 'not recorded'}; withheld because they could not be screened: {d.unscreened ?? 0}. Blocked or withheld text never reaches the Dolphin decision.{d.ranAt ? ` Real SERV run, ${String(d.ranAt).slice(0, 16).replace('T', ' ')} UTC.` : ''}</span>
      </p>
      {misses.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginTop: 18 }}>Misses, shown openly</div>
          <GuardRows rows={misses} />
        </>
      )}
      {showAll ? <div style={{ marginTop: 18 }}><GuardRows rows={rows} /></div> : (
        <details className="src" style={{ marginTop: 14 }}>
          <summary>all {rows.length} texts and verdicts</summary>
          <div style={{ marginTop: 10 }}><GuardRows rows={rows} /></div>
        </details>
      )}
    </div>
  );
}
