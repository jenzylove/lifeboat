/**
 * Lifeboat policy: pure functions, no network.
 * Code opens the clock, Dolphin makes the stay or leave call, code clamps it.
 */

export const POLICY = {
  /** oracle above market by this fraction counts as divergent */
  OPEN_GAP: 0.05,
  /** consecutive divergent reads before the clock opens */
  OPEN_READS: 3,
  /** above this gap, curator silence past HARD_SILENCE_SEC forces an exit whatever the model says */
  HARD_GAP: 0.25,
  HARD_SILENCE_SEC: 30 * 60,
  /** utilization at or above this with the clock open forces an exit (race the drain) */
  HARD_UTILIZATION: 0.95,
  /** the model may not wait longer than this in one decision */
  MAX_WAIT_MIN: 15,
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
  openedAt: number | null; // unix seconds, null = closed
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
  if (g == null) return prev;
  if (g >= POLICY.OPEN_GAP && read.exposureUsd > 0) {
    const divergentReads = prev.divergentReads + 1;
    const openedAt = prev.openedAt ?? (divergentReads >= POLICY.OPEN_READS ? read.ts : null);
    return { marketId: prev.marketId, divergentReads, openedAt };
  }
  return { marketId: prev.marketId, divergentReads: 0, openedAt: null };
}

export function curatorProtectedSince(actions: CuratorAction[], marketId: string, since: number): CuratorAction | null {
  return actions.find(a => a.marketId === marketId && a.ts >= since && PROTECTIVE.includes(a.type)) ?? null;
}

export function curatorSilentFor(actions: CuratorAction[], marketId: string, since: number, now: number): number {
  const any = actions.filter(a => a.marketId === marketId && a.ts >= since).map(a => a.ts);
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
  decidedBy: 'model' | 'rule' | 'model_clamped';
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
  const hardGap = g >= POLICY.HARD_GAP && silent >= POLICY.HARD_SILENCE_SEC && !prot;
  const hardUtil = (i.latest.utilization ?? 0) >= POLICY.HARD_UTILIZATION;
  if (hardGap || hardUtil) {
    return {
      ...base,
      action: 'LEAVE',
      waitMinutes: null,
      targetVault: pickTarget(i.model?.target_vault ?? null),
      decidedBy: 'rule',
      rule: hardUtil ? 'utilization_hard_limit' : 'gap_and_silence_hard_limit',
    };
  }

  const invalid = i.model ? validateModel(i.model, i.evidenceIds) : 'no model output';
  if (!i.model || invalid) {
    // Model down or invalid: the clock keeps running and the hard rules above will fire on time.
    return { ...base, modelError: i.modelError ?? invalid, action: 'WAIT', waitMinutes: 1, targetVault: null, decidedBy: 'rule', rule: 'model_unavailable_wait_for_hard_rule' };
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
