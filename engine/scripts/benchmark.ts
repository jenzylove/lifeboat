/**
 * Does the cheap open model make the same call a frontier model would, and does it stay quiet when it should?
 * Cases (all real data):
 *  - March 22 2026 (Resolv): every exposed position at 02:30, 02:40, 02:50, 03:00 UTC until it leaves. Right call: LEAVE.
 *  - Before the break: each affected market at 01:30 UTC, checked on demand. Right call: not LEAVE.
 *  - Stream (Nov 2025): exposed positions when the market was pinned near fully borrowed, and at the price break. Right call: LEAVE.
 *  - Calm today: 30 or more live markets from the biggest USDC vaults on Base, checked on demand. Right call: not LEAVE.
 *  - Benign gaps today: live markets whose feed sits a little off the market (fixed rate feeds, oracle below market). Right call: not LEAVE.
 * Arms, on identical evidence packs: Dolphin (DeepSeek V4.1 Flash), a frontier model through SERV (Claude Opus 5.5),
 * and Lifeboat as shipped (Dolphin plus the SERV second opinion that can only make the call stricter).
 * Writes data/benchmark.json. Misses are listed, not hidden.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stepClock, openRelated, type ClockState, type CuratorAction, type CuratorActionType, type MarketRead } from '../src/decide/policy.js';
import { decide } from '../src/decide/decide.js';
import type { PackInput, CandidateVault } from '../src/decide/evidence.js';

const ROOT = path.resolve(process.cwd(), '..');
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');
const FRONTIER = process.env.FRONTIER_MODEL ?? 'claude-opus-5.5';
const SAFE: CandidateVault = { address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', name: 'Steakhouse USDC', curator: 'Steakhouse Financial', apy: null, tvlUsd: null, openClocks: 0 };
const SAFE_BASE: CandidateVault = { address: '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183', name: 'Steakhouse USDC', curator: 'Steakhouse Financial', apy: null, tvlUsd: null, openClocks: 0 };
const NAMES: Record<string, string> = { USR: 'Resolv USD', wstUSR: 'Wrapped stUSR', RLP: 'Resolv Liquidity Provider Token', xUSD: 'Staked Stream USD' };

type Truth = 'LEAVE' | 'NOT_LEAVE';
interface Case { id: string; group: string; truth: Truth; pack: PackInput; clock: ClockState; series?: string; minutesFromBreak?: number }

function typeOf(e: any): { type: CuratorActionType; detail: string } {
  const d = e.detail ?? {};
  if (e.type === 'ReallocateWithdraw') return { type: 'reallocate_away', detail: `curator withdrew ${Math.round(d.withdrawnAssets ?? 0)} USDC from the market` };
  if (e.type === 'ReallocateSupply') return { type: 'reallocate_into', detail: `${d.viaPublicAllocator ? 'Public Allocator' : 'curator'} supplied ${Math.round(d.suppliedAssets ?? 0)} USDC into the market` };
  if (e.type === 'SetCap') return { type: Number(d.cap ?? d.newCap ?? 1) === 0 ? 'cap_to_zero' : 'other', detail: `${e.type} ${JSON.stringify(d)}` };
  if (String(e.type).includes('SetFlowCaps')) return { type: 'other', detail: `Public Allocator flow caps set ${JSON.stringify(d)}` };
  return { type: 'other', detail: String(e.type) };
}
const sampleAt = (m: any, now: number) => { let b: any = null; for (const s of m.timeline) if (t(s.ts) <= now) b = s; return b; };

function incidentCases(file: string, opts: { times: string[]; breakIso: string; related?: Record<string, { at: string; to: string[]; reason: string }>; group: string; minSupply: number }): Case[] {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/replay', file), 'utf8'));
  const out: Case[] = [];
  for (const v of src.vaults) for (const em of v.exposedMarkets ?? []) {
    if ((em.vaultSupplyAtDivergence ?? 0) < opts.minSupply) continue;
    const m = src.markets.find((x: any) => x.marketId === em.marketId && x.chainId === v.chainId);
    if (!m) continue;
    const actions: CuratorAction[] = (v.curatorEvents ?? []).filter((e: any) => e.marketId === em.marketId).map((e: any) => ({ ts: t(e.ts), marketId: em.marketId, tx: e.tx, ...typeOf(e) }));
    for (const T of opts.times) {
      const now = t(T);
      let clock: ClockState = { marketId: em.marketId, divergentReads: 0, openedAt: null };
      const reads: MarketRead[] = [];
      for (const s of m.timeline) {
        if (t(s.ts) > now) break;
        if (t(s.ts) < now - 6 * 3600) continue;
        const r: MarketRead = { ts: t(s.ts), marketId: em.marketId, collateralSymbol: m.collateral.symbol, oraclePrice: s.oraclePrice, marketPrice: s.marketPrice, utilization: s.utilization, exposureUsd: em.vaultSupplyAtDivergence };
        reads.push(r);
        clock = stepClock(clock, r);
      }
      const rel = opts.related?.[m.collateral.symbol];
      const related: { ts: number; text: string; source: string }[] = [];
      if (rel && now >= t(rel.at)) {
        clock = openRelated(clock, t(rel.at), rel.to);
        related.push({ ts: t(rel.at), text: `Sweep linked this market's collateral ${m.collateral.symbol} to ${rel.to.join(', ')}, which is breaking: ${rel.reason}`, source: 'Lifeboat sweep' });
      }
      if (clock.openedAt == null) clock = { ...clock, openedAt: now, kind: 'gap' }; // a check at this moment
      const s = sampleAt(m, now);
      out.push({
        id: `${opts.group}:${(v.name ?? 'vault').trim()}:${m.collateral.symbol}:${T.slice(11, 16)}`,
        group: opts.group,
        truth: 'LEAVE',
        series: `${(v.name ?? 'vault').trim()}:${m.collateral.symbol}`,
        minutesFromBreak: Math.round((now - t(opts.breakIso)) / 60),
        clock,
        pack: {
          user: { vault: v.address, vaultName: (v.name ?? 'vault').trim(), curator: v.curator ?? 'unknown', positionUsd: 1000, withdrawableUsd: Math.min(1000, s?.withdrawable ?? 0) },
          marketId: em.marketId, collateral: m.collateral.symbol, clockOpenedAt: clock.openedAt!, now,
          reads: reads.slice(-12), curatorActions: actions.filter(a => a.ts <= now && a.ts >= now - 6 * 3600),
          supplyChanges: [], posts: [], candidates: [m.chainId === 8453 ? SAFE_BASE : SAFE], related,
          readSource: `historical onchain reads: oracle price(), ${s?.priceSource ?? 'market price'}, Morpho Blue market()`,
        },
      });
    }
  }
  return out;
}

function preBreakCases(): Case[] {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/replay/resolv-2026-03-22.json'), 'utf8'));
  const now = t('2026-03-22T01:30:00Z');
  return src.markets.map((m: any) => {
    const reads: MarketRead[] = m.timeline.filter((s: any) => t(s.ts) <= now && t(s.ts) > now - 6 * 3600).map((s: any) => ({ ts: t(s.ts), marketId: m.marketId, collateralSymbol: m.collateral.symbol, oraclePrice: s.oraclePrice, marketPrice: s.marketPrice, utilization: s.utilization, exposureUsd: 10000 })).slice(-12);
    return {
      id: `prebreak:${m.chain}:${m.collateral.symbol}:${m.marketId.slice(0, 8)}`, group: 'march22_before_break', truth: 'NOT_LEAVE' as Truth,
      clock: { marketId: m.marketId, divergentReads: 0, openedAt: now, kind: 'gap' as const },
      pack: {
        user: { vault: '0xvault', vaultName: 'a vault lending into this market', curator: 'unknown', positionUsd: 1000, withdrawableUsd: 1000 },
        marketId: m.marketId, collateral: m.collateral.symbol, clockOpenedAt: now, now, reads, curatorActions: [], supplyChanges: [], posts: [], candidates: [m.chainId === 8453 ? SAFE_BASE : SAFE],
        related: [{ ts: now, text: 'ON DEMAND CHECK: a person asked Lifeboat to assess this market right now. No alarm has fired. Decide what you would do for a $1,000 depositor today: STAY if nothing justifies leaving.', source: 'lifeboat' }],
        readSource: 'historical onchain reads',
      },
    };
  });
}

async function liveCases(): Promise<Case[]> {
  const r = await fetch('https://lifeboat.jdollar.site/api/board');
  const b: any = await r.json();
  const now = Math.floor(Date.now() / 1000);
  const out: Case[] = [];
  for (const v of b.vaults ?? []) for (const m of v.markets ?? []) {
    if (!(m.allocationUsd > 0) || m.oraclePrice == null || m.marketPrice == null) continue;
    const gap = m.gapPct ?? 0;
    const benign = Math.abs(gap) >= 1;
    const group = benign ? 'live_benign_gap' : 'live_calm';
    out.push({
      id: `${group}:${v.name}:${m.collateral}:${m.marketId.slice(0, 8)}`, group, truth: 'NOT_LEAVE',
      clock: { marketId: m.marketId, divergentReads: 0, openedAt: now, kind: 'gap' },
      pack: {
        user: { vault: v.address, vaultName: v.name, curator: v.curator ?? 'unknown', positionUsd: 1000, withdrawableUsd: Math.min(1000, v.withdrawableUsd ?? 0) },
        marketId: m.marketId, collateral: m.collateral, clockOpenedAt: now, now,
        reads: [{ ts: now, marketId: m.marketId, collateralSymbol: m.collateral, oraclePrice: m.oraclePrice, marketPrice: m.marketPrice, utilization: m.utilization, exposureUsd: m.allocationUsd }],
        curatorActions: [], supplyChanges: [], posts: [], candidates: [SAFE_BASE.address.toLowerCase() === v.address.toLowerCase() ? { ...SAFE_BASE, address: '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61', name: 'Gauntlet USDC Prime', curator: 'Gauntlet' } : SAFE_BASE],
        related: [
          { ts: now, text: 'ON DEMAND CHECK: a person asked Lifeboat to assess this market right now. No alarm has fired. Decide what you would do for a $1,000 depositor today: STAY if nothing justifies leaving.', source: 'lifeboat' },
          ...(m.fixedByDesign ? [{ ts: now, text: 'This market oracle price has not changed in 7 days of samples: likely a fixed rate feed by design, so a small steady gap can be normal.', source: 'oracle price() history onchain' }] : []),
        ],
        readSource: `live board read ${b.readAt ?? ''}: oracle price() onchain, market price ${m.marketPriceSource ?? ''}, Morpho Blue market() onchain`,
      },
    });
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]!, k); } }));
  return out;
}

const decisions = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/replay/decisions.json'), 'utf8'));
const flag = (decisions.sweeps ?? []).flatMap((s: any) => s.flags.map((f: any) => ({ ...f, ts: s.ts }))).find((f: any) => /RLP/i.test(f.reason) || true);
const related = flag ? { RLP: { at: '2026-03-22T02:40:00Z', to: ['USR', 'wstUSR'], reason: flag.reason } } : undefined;

const cases: Case[] = [
  ...incidentCases('resolv-2026-03-22.json', { times: ['2026-03-22T02:30:00Z', '2026-03-22T02:40:00Z', '2026-03-22T02:50:00Z', '2026-03-22T03:00:00Z'], breakIso: '2026-03-22T02:27:23Z', related, group: 'march22_exposed', minSupply: 1000 }),
  ...incidentCases('stream-2025-11-04.json', { times: ['2025-11-02T22:00:00Z', '2025-11-03T11:40:00Z'], breakIso: '2025-11-03T11:39:57Z', group: 'stream_exposed', minSupply: 1000 }),
  ...preBreakCases(),
  ...(await liveCases()),
];
console.log('cases', cases.length, Object.entries(cases.reduce((a: any, c) => ((a[c.group] = (a[c.group] ?? 0) + 1), a), {})));

const ONLY = process.env.LIMIT ? cases.slice(0, Number(process.env.LIMIT)) : cases;
const runs = await pool(ONLY, Number(process.env.CONC ?? 6), async (c) => {
  const [d, f] = await Promise.all([
    decide(c.pack, c.clock, 'bench', { skipGuard: true, secondOpinion: true }).catch(e => ({ error: String(e) }) as any),
    decide(c.pack, c.clock, 'bench', { skipGuard: true, secondOpinion: false, arm: 'frontier', frontierModel: FRONTIER }).catch(e => ({ error: String(e) }) as any),
  ]);
  const arm = (rec: any, which: 'first' | 'final') => {
    if (!rec || rec.error) return { action: null, error: rec?.error ?? 'no record', costUsd: null, invalid: null, decidedBy: null };
    const action = which === 'first' ? rec.secondOpinion?.firstAction ?? rec.decision.action : rec.decision.action;
    const invalid = !!rec.decision.modelError && /cites unknown evidence|no reasons|reason without evidence|bad action/.test(rec.decision.modelError);
    const cost = (rec.model?.costUsd ?? 0) + (which === 'final' ? rec.secondOpinion?.costUsd ?? 0 : 0);
    return { action, decidedBy: which === 'final' ? rec.decision.decidedBy : rec.decision.decidedBy === 'serv_second_opinion' ? 'model' : rec.decision.decidedBy, rule: rec.decision.rule, invalid, modelError: rec.decision.modelError, costUsd: rec.model ? cost : null, tokens: rec.model ? rec.model.inputTokens + rec.model.outputTokens : 0, summary: which === 'final' && rec.secondOpinion?.applied ? rec.secondOpinion.summary : rec.decision.model?.summary ?? null };
  };
  const out = { id: c.id, group: c.group, truth: c.truth, series: c.series ?? null, minutesFromBreak: c.minutesFromBreak ?? null, dolphin: arm(d, 'first'), lifeboat: arm(d, 'final'), frontier: arm(f, 'final'), secondOpinion: d?.secondOpinion ? { action: d.secondOpinion.action, applied: d.secondOpinion.applied, model: d.secondOpinion.model, costUsd: d.secondOpinion.costUsd } : null };
  process.stdout.write(`${c.truth === 'LEAVE' ? 'L' : 'S'} ${out.dolphin.action ?? 'x'}/${out.lifeboat.action ?? 'x'}/${out.frontier.action ?? 'x'}  ${c.id}\n`);
  return out;
});

const ARMS = ['dolphin', 'lifeboat', 'frontier'] as const;
const ok = (truth: Truth, a: string | null) => (truth === 'LEAVE' ? a === 'LEAVE' : a === 'STAY' || a === 'WAIT');
const summary: any = {};
for (const k of ARMS) {
  const rs = runs.map(r => ({ r, a: (r as any)[k] }));
  const leaveCases = rs.filter(x => x.r.truth === 'LEAVE' && x.r.group === 'march22_exposed');
  // minutes to LEAVE per series (first time point that says LEAVE)
  const series = new Map<string, number | null>();
  for (const x of leaveCases) {
    const s = x.r.series!;
    if (!series.has(s)) series.set(s, null);
    if (x.a.action === 'LEAVE' && (series.get(s) == null || x.r.minutesFromBreak! < series.get(s)!)) series.set(s, x.r.minutesFromBreak);
  }
  const mins = [...series.values()].filter((v): v is number => v != null);
  const calm = rs.filter(x => x.r.truth === 'NOT_LEAVE');
  const leave = rs.filter(x => x.r.truth === 'LEAVE');
  const costs = rs.map(x => x.a.costUsd).filter((c): c is number => typeof c === 'number');
  summary[k] = {
    correct: rs.filter(x => ok(x.r.truth, x.a.action)).length,
    total: rs.length,
    falseAlarms: calm.filter(x => x.a.action === 'LEAVE').length,
    calmCases: calm.length,
    leaveCaught: leave.filter(x => x.a.action === 'LEAVE').length,
    leaveCases: leave.length,
    positionsLeft: mins.length,
    positions: series.size,
    medianMinutesToLeave: mins.length ? mins.sort((a, b) => a - b)[Math.floor(mins.length / 2)] : null,
    invalidCitations: rs.filter(x => x.a.invalid).length,
    errors: rs.filter(x => x.a.error).length,
    costPerDecisionUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    totalCostUsd: costs.reduce((a, b) => a + b, 0),
    misses: rs.filter(x => !ok(x.r.truth, x.a.action)).map(x => ({ id: x.r.id, truth: x.r.truth, got: x.a.action, by: x.a.decidedBy, rule: x.a.rule ?? null, summary: x.a.summary, error: x.a.error ?? x.a.modelError ?? null })),
  };
}
const outFile = path.join(ROOT, 'data/benchmark.json');
fs.writeFileSync(outFile, JSON.stringify({
  ranAt: new Date().toISOString(),
  question: 'Does the cheap open model on Dolphin make the right call, including staying quiet on calm markets, compared with a frontier model on the same evidence?',
  arms: { dolphin: 'DeepSeek V4.1 Flash on Dolphin, alone', lifeboat: 'Lifeboat as shipped: Dolphin, plus the SERV Reasoning second opinion (Claude Sonnet 5.5) that can only make a STAY or WAIT stricter', frontier: `${FRONTIER} through SERV Reasoning, alone` },
  truth: 'LEAVE cases: exposed positions during real incidents. NOT_LEAVE cases: the same markets before the break, live calm markets today, and live markets with a small benign gap. For NOT_LEAVE, STAY or WAIT both count as correct; LEAVE is a false alarm.',
  hardRules: 'The code hard rules run in every arm (for example 95% borrowed during a price gap forces LEAVE). Each result says whether the model or a rule decided.',
  summary,
  cases: runs,
}, null, 1));
for (const k of ARMS) { const s = summary[k]; console.log(k.padEnd(9), `correct ${s.correct}/${s.total}`, `false alarms ${s.falseAlarms}/${s.calmCases}`, `caught ${s.leaveCaught}/${s.leaveCases}`, `median min ${s.medianMinutesToLeave}`, `invalid ${s.invalidCitations}`, `errors ${s.errors}`, `$/decision ${s.costPerDecisionUsd?.toFixed(6)}`); }
