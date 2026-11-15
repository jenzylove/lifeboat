/**
 * Replay the real Mar 22 2026 timeline through the live Lifeboat code:
 * same clocks, same sweep, same evidence pack, same model call, same clamp. Only the data source differs (historical blocks).
 * Writes data/replay/decisions.json (or $OUT).
 */
import fs from 'node:fs';
import path from 'node:path';
import { stepClock, openRelated, type ClockState, type CuratorAction, type CuratorActionType, type MarketRead } from '../src/decide/policy.js';
import { decide, type DecisionRecord } from '../src/decide/decide.js';
import { sweep, type Break, type GuardedMarket } from '../src/decide/sweep.js';

const DIR = path.resolve(process.cwd(), '../data/replay');
const src = JSON.parse(fs.readFileSync(path.join(DIR, 'resolv-2026-03-22.json'), 'utf8'));
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');
const START = t('2026-03-22T00:00:00Z');
const END = t('2026-03-22T08:00:00Z');
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 80);
const POSITION_USD = 1000;

// Real token names (read onchain with name()).
const NAMES: Record<string, string> = { USR: 'Resolv USD', wstUSR: 'Wrapped stUSR', RLP: 'Resolv Liquidity Provider Token' };

// Featured positions: vaults that held money in an affected market when the price broke.
const featured: { vault: any; em: any; market: any }[] = [];
for (const v of src.vaults) {
  for (const em of v.exposedMarkets ?? []) {
    if ((em.vaultSupplyAtDivergence ?? 0) < 1000) continue;
    const market = src.markets.find((m: any) => m.marketId === em.marketId && m.chainId === v.chainId);
    if (market) featured.push({ vault: v, em, market });
  }
}

function typeOf(e: any): { type: CuratorActionType; detail: string } {
  const d = e.detail ?? {};
  if (e.type === 'ReallocateWithdraw') return { type: 'reallocate_away', detail: `curator withdrew ${Math.round(d.withdrawnAssets ?? 0)} USDC from the market` };
  if (e.type === 'ReallocateSupply') return { type: 'reallocate_into', detail: `${d.viaPublicAllocator ? 'Public Allocator' : 'curator'} supplied ${Math.round(d.suppliedAssets ?? 0)} USDC into the market` };
  if (e.type === 'SetCap' || e.type === 'SubmitCap') return { type: Number(d.cap ?? d.newCap ?? 1) === 0 ? 'cap_to_zero' : 'cap_reduced', detail: `${e.type} ${JSON.stringify(d)}` };
  if (e.type === 'SubmitMarketRemoval') return { type: 'removal_submitted', detail: 'market removal submitted' };
  if (String(e.type).includes('SetFlowCaps')) return { type: 'other', detail: `Public Allocator flow caps set ${JSON.stringify(d)} (stops new inflow, does not withdraw)` };
  if (String(e.type).includes('Queue')) return { type: 'queue_change', detail: e.type };
  return { type: 'other', detail: e.type };
}

// Sample at a market's last timeline point at or before `now`.
const at = (m: any, now: number) => {
  let best: any = null;
  for (const s of m.timeline) if (t(s.ts) <= now) best = s;
  return best;
};

// Market level gap clocks (independent of any one position) define what is "breaking".
const marketClock = new Map<string, ClockState>();
const breakSince = new Map<string, number>();

interface Pos {
  vault: any; em: any; market: any; actions: CuratorAction[]; clock: ClockState; reads: MarketRead[];
  decisions: any[]; leave: any; waitUntil: number; sweepFlag: any;
}
const positions: Pos[] = featured.map(({ vault, em, market }) => ({
  vault, em, market,
  actions: (vault.curatorEvents ?? []).filter((e: any) => e.marketId === em.marketId || String(e.type).includes('FlowCaps')).map((e: any) => ({ ts: t(e.ts), marketId: em.marketId, tx: e.tx, ...typeOf(e) })),
  clock: { marketId: em.marketId, divergentReads: 0, openedAt: null }, reads: [], decisions: [], leave: null, waitUntil: 0, sweepFlag: null,
}));

let calls = 0;
const sweeps: any[] = [];
let lastBreakKey = '';
for (let now = START; now <= END && calls < MAX_CALLS; now += 600) {
  // 1. market clocks and the current break list
  const breaks: Break[] = [];
  for (const m of src.markets) {
    const s = at(m, now);
    if (!s) continue;
    const key = `${m.chainId}:${m.marketId}`;
    const c = stepClock(marketClock.get(key) ?? { marketId: m.marketId, divergentReads: 0, openedAt: null }, { ts: now, marketId: m.marketId, collateralSymbol: m.collateral.symbol, oraclePrice: s.oraclePrice, marketPrice: s.marketPrice, utilization: null, exposureUsd: 1 });
    marketClock.set(key, c);
    if (c.openedAt != null && c.kind === 'gap') {
      if (!breakSince.has(key)) breakSince.set(key, c.openedAt);
      breaks.push({ marketId: m.marketId, collateralSymbol: m.collateral.symbol, collateralName: NAMES[m.collateral.symbol] ?? m.collateral.symbol, collateralAddress: m.collateral.address, gapPct: ((s.oraclePrice - s.marketPrice) / s.marketPrice) * 100, since: breakSince.get(key)!, where: `Morpho ${m.chain}` });
    }
  }
  // 2. sweep when the break set changes
  const bkey = breaks.map(b => b.collateralSymbol + b.marketId).sort().join('|');
  if (breaks.length && bkey !== lastBreakKey) {
    lastBreakKey = bkey;
    const guarded: GuardedMarket[] = positions.filter(p => !p.leave).map(p => ({ marketId: p.em.marketId, collateralSymbol: p.market.collateral.symbol, collateralName: NAMES[p.market.collateral.symbol] ?? p.market.collateral.symbol, collateralAddress: p.market.collateral.address, vaultName: p.vault.name, exposureUsd: p.em.vaultSupplyAtDivergence }));
    const uniq = [...new Map(guarded.map(g => [g.marketId, g])).values()];
    const sw = await sweep(uniq, breaks, now);
    calls++;
    sweeps.push({ ts: iso(now), breaks: breaks.map(b => b.collateralSymbol), flags: sw.flags, model: sw.model, error: sw.error });
    process.stdout.write(`SWEEP ${iso(now)} breaks=${breaks.map(b => b.collateralSymbol).join(',')} flags=${sw.flags.map(f => f.marketId.slice(0, 10)).join(',')} ${sw.error ?? ''}\n`);
    for (const f of sw.flags) for (const p of positions) if (p.em.marketId.toLowerCase() === f.marketId.toLowerCase()) { p.clock = openRelated(p.clock, now, f.related_to); p.sweepFlag ??= { ts: iso(now), ...f }; }
  }
  // 3. per position clocks and decisions
  for (const p of positions) {
    if (p.leave) continue;
    const s = at(p.market, now);
    if (!s) continue;
    const read: MarketRead = { ts: now, marketId: p.em.marketId, collateralSymbol: p.market.collateral.symbol, oraclePrice: s.oraclePrice, marketPrice: s.marketPrice, utilization: s.utilization, exposureUsd: p.em.vaultSupplyAtDivergence };
    p.reads.push(read);
    p.clock = stepClock(p.clock, read);
    if (p.clock.openedAt == null || now < p.waitUntil || calls >= MAX_CALLS) continue;
    calls++;
    const related = p.clock.kind === 'related' ? [
      ...breaks.map(b => ({ ts: b.since, text: `Breaking elsewhere: ${b.collateralSymbol} "${b.collateralName}" on ${b.where}, oracle ${b.gapPct.toFixed(0)}% above market since ${iso(b.since)}`, source: 'Lifeboat market clocks' })),
      ...(p.sweepFlag ? [{ ts: t(p.sweepFlag.ts), text: `Sweep linked this market's collateral ${p.market.collateral.symbol} to ${p.sweepFlag.related_to.join(', ')}: ${p.sweepFlag.reason}`, source: 'Lifeboat sweep (Dolphin)' }] : []),
    ] : [];
    const rec: DecisionRecord = await decide(
      {
        user: { vault: p.vault.address, vaultName: p.vault.name, curator: p.vault.curator ?? 'unknown', positionUsd: POSITION_USD, withdrawableUsd: Math.min(POSITION_USD, s.withdrawable ?? 0) },
        marketId: p.em.marketId,
        collateral: p.market.collateral.symbol,
        clockOpenedAt: p.clock.openedAt,
        now,
        reads: p.reads.filter(r => r.ts >= p.clock.openedAt! - 3600).slice(-12),
        curatorActions: p.actions.filter(a => a.ts <= now && a.ts >= p.clock.openedAt! - 3600),
        supplyChanges: [],
        posts: [],
        candidates: [{ address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', name: 'Steakhouse USDC (Ethereum, no exposure to Resolv markets in this replay)', curator: 'Steakhouse Financial', apy: null, tvlUsd: null, openClocks: 0 }],
        readSource: `historical onchain reads at each block: oracle price(), ${s.priceSource ?? 'market price'}, Morpho Blue market()`,
        related,
      },
      p.clock,
      'replay',
    );
    const d = rec.decision;
    p.decisions.push({ ts: iso(now), sampleTs: s.ts, block: s.block, clockKind: p.clock.kind, action: d.action, decidedBy: d.decidedBy, rule: d.rule, waitMinutes: d.waitMinutes, summary: d.model?.summary ?? null, reasons: d.model?.reasons ?? [], model: rec.model ? { model: rec.model.model, provider: rec.model.provider, inputTokens: rec.model.inputTokens, outputTokens: rec.model.outputTokens, costUsd: rec.model.costUsd, ms: rec.model.ms } : null, modelError: d.modelError, hash: rec.hash, gap: s.oraclePrice && s.marketPrice ? (s.oraclePrice - s.marketPrice) / s.marketPrice : null, utilization: s.utilization, marketWithdrawable: s.withdrawable });
    process.stdout.write(`${p.vault.name} ${iso(now)} [${p.clock.kind}] ${d.action} ${d.decidedBy}${d.rule ? ' ' + d.rule : ''}\n`);
    if (d.action === 'WAIT') p.waitUntil = now + (d.waitMinutes ?? 1) * 60;
    if (d.action === 'LEAVE') {
      // The exit fills at the first real sample at or after the decision where the market can pay the position out (the keeper retries every minute live).
      const fill = p.market.timeline.find((x: any) => t(x.ts) >= now && (x.withdrawable ?? 0) >= POSITION_USD);
      p.leave = { ts: iso(now), block: s.block, decidedBy: d.decidedBy, rule: d.rule, clockKind: p.clock.kind, exitFilledAt: fill?.ts ?? null, exitFillBlock: fill?.block ?? null, marketWithdrawableAtFill: fill?.withdrawable ?? null };
    }
    if (d.action === 'STAY' && p.clock.kind === 'related') p.clock = { marketId: p.em.marketId, divergentReads: 0, openedAt: null };
  }
}

const out = positions.map(p => ({
  vault: { name: p.vault.name.trim(), address: p.vault.address, chain: p.vault.chain, curator: p.vault.curator },
  market: { id: p.em.marketId, collateral: p.market.collateral.symbol, collateralName: NAMES[p.market.collateral.symbol] ?? null },
  priceBreak: p.market.divergence,
  sweepFlag: p.sweepFlag,
  lifeboatLeft: p.leave,
  minutesFromFirstBreakToDecision: p.leave ? Math.round((t(p.leave.ts) - t('2026-03-22T02:27:23Z')) / 60) : null,
  minutesFromFirstBreakToExitFilled: p.leave?.exitFilledAt ? Math.round((t(p.leave.exitFilledAt) - t('2026-03-22T02:27:23Z')) / 60) : null,
  curator: { firstProtectiveAction: p.em.firstProtectiveAction ?? null, minutesFromBreak: p.em.minutesFromIncidentDivergence ?? p.em.minutesFromDivergence ?? null, inflowStop: p.em.inflowStopAction ?? null, minutesToInflowStop: p.em.minutesFromIncidentDivergenceToInflowStop ?? null },
  vaultSupplyAtBreak: p.em.vaultSupplyAtDivergence,
  vaultSupplyEndOfWindow: p.em.vaultSupplyEndOfWindow,
  decisions: p.decisions,
}));
const result = {
  generatedAt: new Date().toISOString(),
  cadence: '10 minute samples (the live watcher reads every minute)',
  firstBreak: '2026-03-22T02:27:23Z',
  note: 'Real historical onchain data replayed through the live Lifeboat clocks, sweep, evidence pack, model call and clamp. Model and provider recorded per call. Position size $1,000 is illustrative; market withdrawable amounts are onchain.',
  sweeps,
  positions: out,
  totals: { modelCalls: calls },
};
fs.writeFileSync(path.join(DIR, process.env.OUT ?? 'decisions.json'), JSON.stringify(result, null, 1));
console.log('positions', out.length, 'model calls', calls);
