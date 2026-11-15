/**
 * Lifeboat policy: pure functions, no network.
 * Code opens the clock, Dolphin makes the stay or leave call, code clamps it.
 */

export const POLICY = {
  /** oracle above market by this fraction counts as divergent */
  OPEN_GAP: 0.05,
  /** the divergence must persist this long (and across at least two reads) before the clock opens; time based so a 1 min live watcher and a 10 min replay mean the same thing */
  OPEN_PERSIST_SEC: 120,
  /** above this gap, curator silence past HARD_SILENCE_SEC forces an exit whatever the model says */
  HARD_GAP: 0.25,
  HARD_SILENCE_SEC: 30 * 60,
  /** utilization at or above this with the clock open forces an exit (race the drain) */
  HARD_UTILIZATION: 0.95,
  /** the model may not wait longer than this in one decision */
  MAX_WAIT_MIN: 15,
  /** utilization at or above this opens a liquidity clock even with no price gap (Stream xUSD: lenders were locked 13 h before the price broke) */
  LIQ_OPEN_UTIL: 0.98,
  /** a liquidity clock still pinned after this long forces an exit of whatever can be withdrawn */
  LIQ_HARD_SEC: 6 * 3600,
  /** model unavailable this long while a clock is open: leave by rule */
  MODEL_DOWN_SEC: 10 * 60,
} as const;

export type CuratorActionType =
  | 'cap_to_zero'
  | 'cap_reduced'
  | 'cap_raised'
  | 'reallocate_away'
  | 'reallocate_into'
  | 'removal_submitted'
  | 'queue_change'
  | 'other';

export interface CuratorAction {
  ts: number; // unix seconds
  type: CuratorActionType;
  marketId: string;
  tx: string;
  detail?: string;
}

export interface MarketRead {
  ts: number;
  marketId: string;
  collateralSymbol: string;
  oraclePrice: number | null; // collateral price in loan units
  marketPrice: number | null;
  utilization: number | null; // 0..1
  exposureUsd: number; // this vault's supply in the market
}

export interface ClockState {
  marketId: string;
  divergentReads: number;
  /** first read in the current divergent run */
  firstSeenAt?: number | null;
  openedAt: number | null; // unix seconds, null = closed
  /** why the clock opened: price gap (feed frozen while market falls) or liquidity (market pinned near fully borrowed) */
  kind?: 'gap' | 'liquidity' | 'related';
  /** for related clocks: what the sweep linked this market to */
  relatedTo?: string[];
  /** first cycle in the current run where the model was unavailable or invalid */
  modelFailSince?: number | null;
}

/** Open a clock because the sweep linked this market to a live break elsewhere. Never closes or downgrades an open clock. */
export function openRelated(prev: ClockState, now: number, relatedTo: string[]): ClockState {
  if (prev.openedAt != null) return prev;
  return { marketId: prev.marketId, divergentReads: prev.divergentReads, firstSeenAt: prev.firstSeenAt ?? null, openedAt: now, kind: 'related', relatedTo };
}

export const PROTECTIVE: CuratorActionType[] = ['cap_to_zero', 'reallocate_away', 'removal_submitted'];

/** Positive gap means the oracle values the collateral above the market: lenders are the ones at risk. */
export function gap(oraclePrice: number | null, marketPrice: number | null): number | null {
  if (oraclePrice == null || marketPrice == null || marketPrice <= 0) return null;
  return (oraclePrice - marketPrice) / marketPrice;
}

/** Advance one market's clock with a new read. Unknown prices never open or close a clock. */
export function stepClock(prev: ClockState, read: MarketRead): ClockState {
  const g = gap(read.oraclePrice, read.marketPrice);
  const pinned = read.utilization != null && read.utilization >= POLICY.LIQ_OPEN_UTIL;
  if (g == null && read.utilization == null) return prev;
  const divergent = g != null && g >= POLICY.OPEN_GAP;
  if ((divergent || pinned) && read.exposureUsd > 0) {
    const divergentReads = prev.divergentReads + 1;
    const firstSeenAt = prev.firstSeenAt ?? read.ts;
    const opening = prev.openedAt == null && divergentReads >= 2 && read.ts - firstSeenAt >= POLICY.OPEN_PERSIST_SEC;
    const openedAt = prev.openedAt ?? (opening ? read.ts : null);
    // A gap upgrades a liquidity clock; it never downgrades.
    const kind = openedAt == null ? undefined : divergent ? 'gap' : (prev.kind ?? 'liquidity');
    return { marketId: prev.marketId, divergentReads, firstSeenAt, openedAt, ...(kind ? { kind } : {}) };
  }
  if (prev.kind === 'related' && prev.openedAt != null) return prev; // the feed is what is blind here; only a decision closes it
  if (g == null && !pinned && prev.openedAt != null && prev.kind !== 'liquidity') return prev; // unknown price keeps a gap clock as is
  return { marketId: prev.marketId, divergentReads: 0, openedAt: null };
}

export function curatorProtectedSince(actions: CuratorAction[], marketId: string, since: number): CuratorAction | null {
  return actions.find(a => a.marketId === marketId && a.ts >= since && PROTECTIVE.includes(a.type)) ?? null;
}

export function curatorSilentFor(actions: CuratorAction[], marketId: string, since: number, now: number): number {
  // Money flowing INTO the broken market is not the curator protecting anyone; it does not end the silence.
  const any = actions.filter(a => a.marketId === marketId && a.ts >= since && a.type !== 'reallocate_into').map(a => a.ts);
  const last = any.length ? Math.max(...any) : since;
  return Math.max(0, now - last);
}

export type Action = 'STAY' | 'WAIT' | 'LEAVE';

export interface ModelDecision {
  action: Action;
  wait_minutes: number | null;
  target_vault: string | null;
  confidence: number;
  reasons: { claim: string; evidence_ids: string[] }[];
  summary: string;
}

export interface FinalDecision {
  action: Action;
  waitMinutes: number | null;
  targetVault: string | null;
  decidedBy: 'model' | 'rule' | 'model_clamped' | 'serv_second_opinion';
  rule: string | null;
  model: ModelDecision | null;
  modelError: string | null;
}

export interface ClampInput {
  now: number;
  clock: ClockState;
  latest: MarketRead;
  curatorActions: CuratorAction[];
  candidates: string[]; // approved vaults with no open clock, best first
  model: ModelDecision | null;
  modelError?: string | null;
  evidenceIds: Set<string>;
  /** the curator history could not be read this cycle: unknown is never counted as silence */
  curatorUnknown?: boolean;
  /** the model asked to wait and the wait has not elapsed: apply hard rules only, do not consult the model */
  skipModel?: boolean;
}

/** Validate the model output shape and that every cited evidence id exists. Returns an error string or null. */
export function validateModel(m: unknown, evidenceIds: Set<string>): string | null {
  if (!m || typeof m !== 'object') return 'not an object';
  const d = m as Partial<ModelDecision>;
  if (!['STAY', 'WAIT', 'LEAVE'].includes(d.action as string)) return 'bad action';
  if (!Array.isArray(d.reasons) || d.reasons.length === 0) return 'no reasons';
  for (const r of d.reasons) {
    if (!r || typeof r.claim !== 'string' || !Array.isArray(r.evidence_ids) || r.evidence_ids.length === 0) return 'reason without evidence';
    for (const id of r.evidence_ids) if (!evidenceIds.has(id)) return `cites unknown evidence ${id}`;
  }
  if (typeof d.summary !== 'string') return 'no summary';
  if (d.wait_minutes != null && (typeof d.wait_minutes !== 'number' || !Number.isFinite(d.wait_minutes))) return 'bad wait_minutes';
  if (d.confidence != null && (typeof d.confidence !== 'number' || !Number.isFinite(d.confidence))) return 'bad confidence';
  if (d.target_vault != null && typeof d.target_vault !== 'string') return 'bad target_vault';
  return null;
}

/** Code has the last word. Order: curator protected -> hard rules -> model (clamped) -> fallback rule. */
export function clamp(i: ClampInput): FinalDecision {
  const base = { model: i.model, modelError: i.modelError ?? null };
  const pickTarget = (want: string | null) => (want && i.candidates.includes(want) ? want : i.candidates[0] ?? null);

  if (i.clock.openedAt == null) return { ...base, action: 'STAY', waitMinutes: null, targetVault: null, decidedBy: 'rule', rule: 'no_clock' };

  const prot = curatorProtectedSince(i.curatorActions, i.clock.marketId, i.clock.openedAt);
  if (prot && i.latest.exposureUsd === 0) {
    return { ...base, action: 'STAY', waitMinutes: null, targetVault: null, decidedBy: 'rule', rule: `curator_acted:${prot.type}` };
  }

  const g = gap(i.latest.oraclePrice, i.latest.marketPrice) ?? 0;
  const silent = curatorSilentFor(i.curatorActions, i.clock.marketId, i.clock.openedAt, i.now);
  // Silence only counts when the curator history was actually read.
  const hardGap = !i.curatorUnknown && g >= POLICY.HARD_GAP && silent >= POLICY.HARD_SILENCE_SEC && !prot;
  const isGap = (i.clock.kind ?? 'gap') === 'gap';
  const hardUtil = isGap && (i.latest.utilization ?? 0) >= POLICY.HARD_UTILIZATION;
  const hardLiq = i.clock.kind === 'liquidity' && i.now - i.clock.openedAt >= POLICY.LIQ_HARD_SEC;
  if (hardGap || hardUtil || hardLiq) {
    return {
      ...base,
      action: 'LEAVE',
      waitMinutes: null,
      targetVault: pickTarget(i.model?.target_vault ?? null),
      decidedBy: 'rule',
      rule: hardLiq ? 'pinned_utilization_hard_limit' : hardUtil ? 'utilization_hard_limit' : 'gap_and_silence_hard_limit',
    };
  }

  if (i.skipModel) {
    return { ...base, action: 'WAIT', waitMinutes: 1, targetVault: null, decidedBy: 'rule', rule: 'model_wait_in_progress' };
  }

  const invalid = i.model ? validateModel(i.model, i.evidenceIds) : 'no model output';
  if (!i.model || invalid) {
    // Model down or invalid. If it has been down long enough while the clock runs, leave by rule; otherwise check again next cycle.
    const downSince = i.clock.modelFailSince ?? i.now;
    if (i.now - downSince >= POLICY.MODEL_DOWN_SEC) {
      return { ...base, modelError: i.modelError ?? invalid, action: 'LEAVE', waitMinutes: null, targetVault: pickTarget(null), decidedBy: 'rule', rule: 'model_unavailable_fallback' };
    }
    return { ...base, modelError: i.modelError ?? invalid, action: 'WAIT', waitMinutes: 1, targetVault: null, decidedBy: 'rule', rule: 'model_unavailable_retry' };
  }

  const m = i.model;
  if (m.action === 'LEAVE') {
    const t = pickTarget(m.target_vault);
    return { ...base, action: 'LEAVE', waitMinutes: null, targetVault: t, decidedBy: t === m.target_vault ? 'model' : 'model_clamped', rule: null };
  }
  if (m.action === 'WAIT') {
    const w = Math.max(1, Math.min(POLICY.MAX_WAIT_MIN, Math.round(m.wait_minutes ?? 1)));
    return { ...base, action: 'WAIT', waitMinutes: w, targetVault: null, decidedBy: w === m.wait_minutes ? 'model' : 'model_clamped', rule: null };
  }
  return { ...base, action: 'STAY', waitMinutes: null, targetVault: null, decidedBy: 'model', rule: null };
}
