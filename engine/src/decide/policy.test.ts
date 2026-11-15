import { describe, it, expect } from 'vitest';
import { clamp, stepClock, openRelated, gap, POLICY, type ClockState, type MarketRead, type ModelDecision } from './policy.js';

const M = 'm1';
const read = (ts: number, o: number, p: number, u = 0.9, exp = 100): MarketRead => ({ ts, marketId: M, collateralSymbol: 'wstUSR', oraclePrice: o, marketPrice: p, utilization: u, exposureUsd: exp });
const open = (at = 1000): ClockState => ({ marketId: M, divergentReads: 3, openedAt: at });
const ids = new Set(['E1', 'E2']);
const model = (m: Partial<ModelDecision>): ModelDecision => ({ action: 'STAY', wait_minutes: null, target_vault: null, confidence: 0.7, reasons: [{ claim: 'x', evidence_ids: ['E1'] }], summary: 's', ...m });

describe('gap', () => {
  it('positive when oracle above market', () => expect(gap(1.13, 0.63)).toBeCloseTo(0.7937, 3));
  it('null on missing', () => expect(gap(null, 1)).toBeNull());
});

describe('stepClock', () => {
  it('opens once the divergence has held for the persistence window and keeps the first open time', () => {
    let c: ClockState = { marketId: M, divergentReads: 0, openedAt: null };
    c = stepClock(c, read(0, 1.13, 1.0));
    c = stepClock(c, read(60, 1.13, 1.0));
    expect(c.openedAt).toBeNull();
    c = stepClock(c, read(120, 1.13, 1.0));
    expect(c.openedAt).toBe(120);
    c = stepClock(c, read(180, 1.13, 0.6));
    expect(c.openedAt).toBe(120);
  });
  it('a single read never opens, even after a long gap in sampling', () => {
    const c = stepClock({ marketId: M, divergentReads: 0, openedAt: null }, read(600, 1.13, 1.0));
    expect(c.openedAt).toBeNull();
  });
  it('closes when prices converge', () => {
    expect(stepClock(open(), read(5, 1.0, 1.0)).openedAt).toBeNull();
  });
  it('unknown price does not change the clock', () => {
    const c = open();
    expect(stepClock(c, { ...read(5, 1, 1), marketPrice: null })).toEqual(c);
  });
  it('pinned utilization opens a liquidity clock without a gap', () => {
    let c: ClockState = { marketId: M, divergentReads: 0, openedAt: null };
    for (const t of [0, 60, 120]) c = stepClock(c, read(t, 1.0, 1.0, 0.99));
    expect(c).toMatchObject({ openedAt: 120, kind: 'liquidity' });
    c = stepClock(c, read(180, 1.13, 0.9, 0.99));
    expect(c.kind).toBe('gap');
  });
  it('a related clock opens on a sweep flag and survives calm reads of its own feed', () => {
    let c = openRelated({ marketId: M, divergentReads: 0, openedAt: null }, 500, ['USR']);
    expect(c).toMatchObject({ openedAt: 500, kind: 'related', relatedTo: ['USR'] });
    c = stepClock(c, read(560, 1.28, 1.47, 0.83));
    expect(c.openedAt).toBe(500);
    expect(openRelated(open(10), 900, ['X']).openedAt).toBe(10);
  });
  it('no exposure, no clock', () => {
    let c: ClockState = { marketId: M, divergentReads: 2, openedAt: null };
    c = stepClock(c, read(3, 1.13, 0.6, 0.5, 0));
    expect(c.openedAt).toBeNull();
  });
});

describe('clamp', () => {
  const base = { now: 1000 + 600, clock: open(), latest: read(1600, 1.13, 1.0), curatorActions: [], candidates: ['vB', 'vC'], evidenceIds: ids };

  it('no clock means stay', () => {
    expect(clamp({ ...base, clock: { marketId: M, divergentReads: 0, openedAt: null }, model: null }).rule).toBe('no_clock');
  });
  it('model LEAVE with approved target goes through', () => {
    const d = clamp({ ...base, model: model({ action: 'LEAVE', target_vault: 'vC' }) });
    expect(d).toMatchObject({ action: 'LEAVE', targetVault: 'vC', decidedBy: 'model' });
  });
  it('model LEAVE to an unapproved vault is clamped to the best candidate', () => {
    const d = clamp({ ...base, model: model({ action: 'LEAVE', target_vault: 'evil' }) });
    expect(d).toMatchObject({ action: 'LEAVE', targetVault: 'vB', decidedBy: 'model_clamped' });
  });
  it('WAIT is capped', () => {
    const d = clamp({ ...base, model: model({ action: 'WAIT', wait_minutes: 600 }) });
    expect(d.waitMinutes).toBe(POLICY.MAX_WAIT_MIN);
  });
  it('hard gap plus silence overrides a STAY', () => {
    const d = clamp({ ...base, now: 1000 + POLICY.HARD_SILENCE_SEC + 1, latest: read(0, 1.13, 0.63), model: model({ action: 'STAY' }) });
    expect(d).toMatchObject({ action: 'LEAVE', decidedBy: 'rule', rule: 'gap_and_silence_hard_limit' });
  });
  it('utilization limit overrides', () => {
    const d = clamp({ ...base, latest: read(0, 1.13, 1.0, 0.97), model: model({ action: 'WAIT', wait_minutes: 5 }) });
    expect(d.rule).toBe('utilization_hard_limit');
  });
  it('curator capped and reallocated away: stay', () => {
    const d = clamp({ ...base, latest: read(0, 1.13, 0.6, 0.99, 0), curatorActions: [{ ts: 1200, type: 'reallocate_away', marketId: M, tx: '0x1' }], model: model({ action: 'LEAVE' }) });
    expect(d.rule).toBe('curator_acted:reallocate_away');
  });
  it('curator protective action stops the hard gap rule while exposure remains', () => {
    const d = clamp({ ...base, now: 1000 + POLICY.HARD_SILENCE_SEC + 1, latest: read(0, 1.13, 0.63), curatorActions: [{ ts: 1100, type: 'cap_to_zero', marketId: M, tx: '0x2' }], model: model({ action: 'WAIT', wait_minutes: 3 }) });
    expect(d).toMatchObject({ action: 'WAIT', decidedBy: 'model' });
  });
  it('model citing evidence that does not exist is rejected', () => {
    const d = clamp({ ...base, model: model({ action: 'LEAVE', reasons: [{ claim: 'made up', evidence_ids: ['E99'] }] }) });
    expect(d).toMatchObject({ action: 'WAIT', rule: 'model_unavailable_wait_for_hard_rule' });
    expect(d.modelError).toContain('E99');
  });
  it('liquidity clock: model decides, no instant utilization exit; forced after the hard window', () => {
    const liq = { ...open(), kind: 'liquidity' as const };
    const early = clamp({ ...base, clock: liq, latest: read(0, 1, 1, 0.99), model: model({ action: 'WAIT', wait_minutes: 10 }) });
    expect(early).toMatchObject({ action: 'WAIT', decidedBy: 'model' });
    const late = clamp({ ...base, clock: liq, now: 1000 + POLICY.LIQ_HARD_SEC, latest: read(0, 1, 1, 0.99), model: model({ action: 'STAY' }) });
    expect(late.rule).toBe('pinned_utilization_hard_limit');
  });
  it('public allocator money flowing in does not count as the curator speaking', () => {
    const d = clamp({ ...base, now: 1000 + POLICY.HARD_SILENCE_SEC + 1, latest: read(0, 1.13, 0.63, 0.5), curatorActions: [{ ts: 1500, type: 'reallocate_into', marketId: M, tx: '0x3' }], model: model({ action: 'WAIT', wait_minutes: 5 }) });
    expect(d.rule).toBe('gap_and_silence_hard_limit');
  });
  it('model down: wait for hard rule', () => {
    const d = clamp({ ...base, model: null, modelError: 'timeout' });
    expect(d).toMatchObject({ action: 'WAIT', modelError: 'timeout' });
  });
});
