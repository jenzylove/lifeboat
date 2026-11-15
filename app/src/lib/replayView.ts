// Turns data/replay/<incident>.json (schema: incident, sources, markets[], vaults[]) and data/replay/decisions.json
// (schema: generatedAt, cadence, firstBreak, note, sweeps[], positions[], totals) into what the player draws.
// Never invents values: missing pieces stay null and the UI says so.

export interface ReplayPoint { ts: number; block: number | null; oraclePrice: number | null; marketPrice: number | null; utilization: number | null; withdrawable: number | null }
export interface TxRef { ts: number; type: string; label: string; tx: string; explorer: string }
export interface ReplayVault {
  name: string; curator: string | null; chainId: number; address: string;
  firstAction: TxRef | null;
  supplyAtDivergence: number | null; supplyEnd: number | null; marketCashAtDivergence: number | null;
  inflowStop: TxRef | null;
}
export interface ReplayMarket {
  key: string; marketId: string; chainId: number; chainName: string; label: string; collateral: string; loan: string;
  points: ReplayPoint[];
  clockOpenAt: number | null; clockGap: number | null; clockSource: string | null;
  fullUtilAt: number | null; fullUtilBeforeBreak: boolean;
  priceSource: string | null;
  vaults: ReplayVault[];
}
export interface Incident {
  id: 'resolv' | 'stream' | string;
  file: string;
  title: string; short: string; summary: string | null; units: string | null;
  incidentAt: number | null;
  windowFrom: number | null; windowTo: number | null;
  markets: ReplayMarket[];
  sources: string[];
}

export interface DecisionPoint {
  ts: number; action: string; decidedBy: string; rule: string | null; clockKind: string | null; summary: string | null;
  reasons: { claim: string; evidence_ids: string[] }[];
  model: string | null; provider: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
  modelError: string | null; hash: string | null; gap: number | null; utilization: number | null; marketWithdrawable: number | null;
}
export interface PositionView {
  vaultName: string; vaultAddress: string; chain: string; curator: string | null;
  marketId: string; collateral: string; collateralName: string | null;
  priceBreakAt: number | null;
  sweepFlag: { ts: number; reason: string | null; relatedTo: string[] } | null;
  left: { ts: number; decidedBy: string; rule: string | null; clockKind: string | null; exitFilledAt: number | null; withdrawableAtFill: number | null; model: string | null } | null;
  minDecision: number | null; minFilled: number | null;
  curatorFirst: TxRef | null; curatorMin: number | null;
  inflowStop: TxRef | null; inflowStopMin: number | null;
  supplyAtBreak: number | null; supplyEnd: number | null;
  decisions: DecisionPoint[];
}
export interface SweepView {
  ts: number; breaks: string[];
  flags: { marketId: string; relatedTo: string[]; reason: string | null }[];
  model: string | null; provider: string | null; costUsd: number | null; error: string | null;
}
export interface DecisionsView {
  generatedAt: string | null; cadence: string | null; firstBreak: number | null; note: string | null;
  sweeps: SweepView[]; positions: PositionView[]; modelCalls: number | null; models: string[];
}

type J = any;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const ts = (v: unknown): number | null => {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? Math.floor(t / 1000) : null; }
  return null;
};
const CHAINS: Record<number, { name: string; ex: string }> = {
  1: { name: 'Ethereum', ex: 'https://etherscan.io' },
  8453: { name: 'Base', ex: 'https://basescan.org' },
  42161: { name: 'Arbitrum', ex: 'https://arbiscan.io' },
};
const chainOf = (id: number) => CHAINS[id] ?? { name: `chain ${id}`, ex: 'https://etherscan.io' };
const chainIdByName = (s: string | null | undefined) => (s === 'base' ? 8453 : s === 'arbitrum' ? 42161 : 1);

const ACTION_WORDS: Record<string, string> = {
  ReallocateWithdraw: 'moved money out of the market',
  SetCap: 'cut the market cap',
  SubmitMarketRemoval: 'started removing the market',
  SetSupplyQueue: 'dropped the market from the supply queue',
  'PublicAllocator.SetFlowCaps': 'stopped outside money flowing in',
};
const txRef = (a: J, chainId: number): TxRef | null => {
  if (!a || !a.tx) return null;
  const t = ts(a.ts);
  if (t === null) return null;
  return { ts: t, type: String(a.type ?? ''), label: ACTION_WORDS[a.type] ?? a.action ?? a.type ?? 'curator action', tx: a.tx, explorer: `${chainOf(chainId).ex}/tx/${a.tx}` };
};

export function buildIncident(id: string, file: string, main: J): Incident | null {
  if (!main || !Array.isArray(main.markets)) return null;
  const inc: Incident = {
    id, file,
    title: main.incident?.name ?? file,
    short: id === 'resolv' ? 'Resolv, Mar 22 2026' : id === 'stream' ? 'Stream, Nov 2025' : (main.incident?.name ?? file),
    summary: main.incident?.summary ?? null, units: main.incident?.units ?? null,
    incidentAt: ts(main.incident?.incidentDivergence?.ts) ?? ts(main.markets[0]?.divergence?.ts),
    windowFrom: ts(main.incident?.window?.from), windowTo: ts(main.incident?.window?.to),
    markets: [], sources: Array.isArray(main.sources) ? main.sources.filter((s: unknown) => typeof s === 'string') : [],
  };
  for (const m of main.markets as J[]) {
    const chainId = num(m.chainId) ?? 1;
    const coll = m.collateral?.symbol ?? '?';
    const loan = m.loan?.symbol ?? '?';
    const points: ReplayPoint[] = (Array.isArray(m.timeline) ? m.timeline : []).map((p: J) => ({
      ts: ts(p.ts)!, block: num(p.block), oraclePrice: num(p.oraclePrice), marketPrice: num(p.marketPrice),
      utilization: num(p.utilization), withdrawable: num(p.withdrawable),
    })).filter((p: ReplayPoint) => p.ts !== null).sort((a: ReplayPoint, b: ReplayPoint) => a.ts - b.ts);
    const clockOpenAt = ts(m.divergence?.ts);
    const fullAfter = ts(m.fullUtilizationAfterDivergence?.ts);
    const fullFirst = ts(m.firstFullUtilizationSample?.ts);
    const fullUtilAt = fullAfter ?? fullFirst;

    const vaults: ReplayVault[] = [];
    for (const v of (main.vaults ?? []) as J[]) {
      const em = (v.exposedMarkets ?? []).find((x: J) => x.marketId === m.marketId);
      if (!em || (num(v.chainId) ?? chainId) !== chainId || !v.name) continue;
      const exposure = Math.max(num(em.vaultSupplyAtDivergence) ?? 0, num(em.vaultSupplyEndOfWindow) ?? 0, num(em.vaultSupplyNov1) ?? 0, num(em.vaultSupplyPreIncident) ?? 0);
      const fa = txRef(em.firstProtectiveAction ?? (v.firstProtectiveAction ? { ts: v.firstProtectiveActionTs, ...v.firstProtectiveAction } : null), chainId);
      if (exposure < 1 && !fa) continue;
      vaults.push({
        name: String(v.name).trim(), curator: typeof v.curator === 'string' ? v.curator.replace(/\s*\(inferred.*$/, '') : null, chainId, address: v.address,
        firstAction: fa,
        supplyAtDivergence: num(em.vaultSupplyAtDivergence), supplyEnd: num(em.vaultSupplyEndOfWindow),
        marketCashAtDivergence: num(em.marketWithdrawableAtDivergence),
        inflowStop: txRef(em.inflowStopAction, chainId),
      });
    }
    vaults.sort((a, b) => (a.firstAction?.ts ?? Infinity) - (b.firstAction?.ts ?? Infinity));
    if (points.length < 2) continue;
    inc.markets.push({
      key: `${chainId}:${m.marketId}`, marketId: m.marketId, chainId, chainName: chainOf(chainId).name,
      label: `${coll} / ${loan} on ${chainOf(chainId).name}`, collateral: coll, loan,
      points, clockOpenAt, clockGap: num(m.divergence?.gap), clockSource: m.divergence?.source ?? null,
      fullUtilAt, fullUtilBeforeBreak: fullUtilAt !== null && clockOpenAt !== null && fullUtilAt < clockOpenAt,
      priceSource: m.timeline?.find((p: J) => p.priceSource)?.priceSource ?? null,
      vaults,
    });
  }
  return inc.markets.length ? inc : null;
}

const modelOf = (m: J) => (m && typeof m.model === 'string' ? m.model : null);

export function buildDecisions(raw: J): DecisionsView | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.positions)) return null;
  const models = new Set<string>();
  const sweeps: SweepView[] = (Array.isArray(raw.sweeps) ? raw.sweeps : []).map((s: J) => {
    const mm = modelOf(s.model); if (mm) models.add(mm);
    return {
      ts: ts(s.ts) ?? 0, breaks: Array.isArray(s.breaks) ? s.breaks.map(String) : [],
      flags: (Array.isArray(s.flags) ? s.flags : []).map((f: J) => ({ marketId: String(f.marketId ?? ''), relatedTo: Array.isArray(f.related_to) ? f.related_to.map(String) : [], reason: typeof f.reason === 'string' ? f.reason : null })),
      model: mm, provider: s.model?.provider ?? null, costUsd: num(s.model?.costUsd), error: s.error ?? null,
    };
  }).sort((a: SweepView, b: SweepView) => a.ts - b.ts);

  const positions: PositionView[] = (raw.positions as J[]).map((p) => {
    const chainId = chainIdByName(p.vault?.chain);
    const decisions: DecisionPoint[] = (Array.isArray(p.decisions) ? p.decisions : []).map((d: J) => {
      const mm = modelOf(d.model); if (mm && d.decidedBy !== 'rule') models.add(mm);
      return {
        ts: ts(d.ts) ?? 0, action: String(d.action ?? ''), decidedBy: String(d.decidedBy ?? ''), rule: d.rule ?? null, clockKind: d.clockKind ?? null,
        summary: typeof d.summary === 'string' ? d.summary : null,
        reasons: Array.isArray(d.reasons) ? d.reasons.filter((r: J) => r && typeof r.claim === 'string') : [],
        model: mm, provider: d.model?.provider ?? null, inputTokens: num(d.model?.inputTokens), outputTokens: num(d.model?.outputTokens), costUsd: num(d.model?.costUsd),
        modelError: d.modelError ?? null, hash: d.hash ?? null, gap: num(d.gap), utilization: num(d.utilization), marketWithdrawable: num(d.marketWithdrawable),
      };
    }).sort((a: DecisionPoint, b: DecisionPoint) => a.ts - b.ts);
    const L = p.lifeboatLeft;
    const leaveDec = L ? decisions.find((d) => d.ts === ts(L.ts)) ?? decisions.filter((d) => d.action === 'LEAVE')[0] : null;
    return {
      vaultName: String(p.vault?.name ?? '').trim(), vaultAddress: String(p.vault?.address ?? ''), chain: chainOf(chainId).name, curator: p.vault?.curator ?? null,
      marketId: String(p.market?.id ?? ''), collateral: String(p.market?.collateral ?? '?'), collateralName: p.market?.collateralName ?? null,
      priceBreakAt: ts(p.priceBreak?.ts),
      sweepFlag: p.sweepFlag ? { ts: ts(p.sweepFlag.ts) ?? 0, reason: p.sweepFlag.reason ?? null, relatedTo: Array.isArray(p.sweepFlag.related_to) ? p.sweepFlag.related_to : [] } : null,
      left: L ? {
        ts: ts(L.ts) ?? 0, decidedBy: String(L.decidedBy ?? ''), rule: L.rule ?? null, clockKind: L.clockKind ?? null,
        exitFilledAt: ts(L.exitFilledAt), withdrawableAtFill: num(L.marketWithdrawableAtFill),
        model: L.decidedBy === 'rule' ? null : leaveDec?.model ?? null,
      } : null,
      minDecision: num(p.minutesFromFirstBreakToDecision), minFilled: num(p.minutesFromFirstBreakToExitFilled),
      curatorFirst: txRef(p.curator?.firstProtectiveAction, chainId), curatorMin: num(p.curator?.minutesFromBreak),
      inflowStop: txRef(p.curator?.inflowStop, chainId), inflowStopMin: num(p.curator?.minutesToInflowStop),
      supplyAtBreak: num(p.vaultSupplyAtBreak), supplyEnd: num(p.vaultSupplyEndOfWindow),
      decisions,
    };
  });
  return {
    generatedAt: raw.generatedAt ?? null, cadence: raw.cadence ?? null, firstBreak: ts(raw.firstBreak), note: raw.note ?? null,
    sweeps, positions, modelCalls: num(raw.totals?.modelCalls), models: [...models],
  };
}

export interface ReplayPayload { incidents: Incident[]; decisions: DecisionsView | null; decisionsFile: string; errors: Record<string, string> }
