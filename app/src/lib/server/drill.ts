import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Address } from 'viem';
import * as keeper from '@engine/keeper.js';
import * as decideMod from '@engine/decide/decide.js';
import { houseEvents } from './house';
import { DATA_DIR } from './config';
import { redact } from './redact';

export const DRILL_WINDOW_S = 10 * 60;

const g = globalThis as unknown as { __lbDrill?: { lastAt: number; running: boolean } };
const state = (g.__lbDrill ??= { lastAt: 0, running: false });

type Notice = { text: string; provider: string; model: string } | null;

/** Cross process keeper lock from the engine (mkdir lock under DATA_DIR/locks/keeper). Falls back to running directly if the engine build predates it. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = (keeper as unknown as { withKeeperLock?: <R>(f: () => Promise<R>) => Promise<R> }).withKeeperLock;
  return typeof lock === 'function' ? lock(fn) : fn();
}

/** SERV Reasoning notice built from the transaction result. Null when there is no SERV key or the call fails. */
async function drillNotice(fromName: string, toName: string, tx: { ok: boolean; explorer?: string; error?: string }): Promise<Notice> {
  const reasons = [
    'A visitor pressed Run a fire drill on the public house boat.',
    `The keeper exited ${fromName} and parked the money in ${toName}, the other vault the owner approved.`,
    'This was a drill: no price feed or curator problem caused it.',
  ];
  try {
    const after = (decideMod as unknown as { noticeAfterTx?: (a: unknown, r: string[]) => Promise<Notice> }).noticeAfterTx;
    if (typeof after === 'function') return (await after({ action: 'LEAVE', fromName, toName, tx }, reasons)) ?? null;
    if (!process.env.SERV_API_KEY) return null;
    const d = { action: 'LEAVE' as const, waitMinutes: null, targetVault: null, decidedBy: 'rule' as const, rule: 'fire_drill', model: null, modelError: null };
    const r = await decideMod.writeNotice(d, reasons.join('\n'), fromName, toName);
    return r?.text ? { text: r.text, provider: r.provider, model: r.model } : null;
  } catch {
    return null;
  }
}

/** Next time a drill is allowed: the later of the in memory clock and the last Exited event onchain. */
export async function drillGate(account: Address): Promise<{ allowed: boolean; nextAt: number; lastOnchainAt: number | null; running: boolean; reason: string | null }> {
  const now = Math.floor(Date.now() / 1000);
  let lastOnchainAt: number | null = null;
  try {
    const ev = await houseEvents(account);
    lastOnchainAt = ev.events.find((e) => e.kind === 'Exited')?.timestamp ?? null;
  } catch {}
  const last = Math.max(state.lastAt, lastOnchainAt ?? 0);
  const nextAt = last + DRILL_WINDOW_S;
  if (state.running) return { allowed: false, nextAt, lastOnchainAt, running: true, reason: 'a fire drill is running right now' };
  if (now < nextAt) return { allowed: false, nextAt, lastOnchainAt, running: false, reason: `one fire drill every 10 minutes; next one opens in ${Math.ceil((nextAt - now) / 60)} min` };
  return { allowed: true, nextAt: now, lastOnchainAt, running: false, reason: null };
}

export async function fireDrill(account: Address, ip: string) {
  // Claim the slot synchronously, before any await, so two requests in the same process cannot both pass.
  if (state.running) return { ok: false as const, status: 429, error: 'a fire drill is running right now', gate: null };
  state.running = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    let lastOnchainAt: number | null = null;
    try { lastOnchainAt = (await houseEvents(account)).events.find((e) => e.kind === 'Exited')?.timestamp ?? null; } catch {}
    const nextAt = Math.max(state.lastAt, lastOnchainAt ?? 0) + DRILL_WINDOW_S;
    if (now < nextAt) {
      return { ok: false as const, status: 429, error: `one fire drill every 10 minutes; next one opens in ${Math.ceil((nextAt - now) / 60)} min`, gate: { allowed: false, nextAt, lastOnchainAt, running: false, reason: null } };
    }
    const prevLast = state.lastAt;
    state.lastAt = now;
    try {
      return await withLock(async () => {
        const before = await keeper.accountStatus(account);
        const record: Record<string, unknown> = {
          kind: 'fire_drill',
          version: 1,
          at: now,
          account,
          requester: createHash('sha256').update(`${ip}:${process.env.DRILL_SALT ?? 'lifeboat'}`).digest('hex').slice(0, 16),
          before: { total: before.total, idle: before.idle, positions: before.positions.map((p) => ({ vault: p.vault, assets: p.assets })) },
        };
        const recordHash = '0x' + createHash('sha256').update(JSON.stringify(record)).digest('hex');
        const r = await keeper.runDrill(account, recordHash);
        const fromName = r.before.positions.find((p) => p.vault === r.from)?.name ?? r.from;
        const toName = r.after.positions.find((p) => p.vault === r.to)?.name ?? r.to;
        const notice = await drillNotice(fromName, toName, { ok: r.tx.status === 'success', explorer: r.tx.explorer });
        const out = { record, recordHash, tx: { ...r.tx, block: Number(r.tx.block) }, from: r.from, to: r.to, before: r.before, after: r.after, notice };
        try {
          const dir = path.join(DATA_DIR, 'drills');
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, `${now}-${recordHash.slice(2, 10)}.json`), JSON.stringify(out, null, 2));
        } catch {}
        return { ok: true as const, ...out };
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // Nothing was sent for these, so reopen the window.
      if (/KEEPER_PK not set|holds nothing|no second approved|lock/i.test(raw)) state.lastAt = prevLast;
      return { ok: false as const, status: /KEEPER_PK|holds nothing|no second/i.test(raw) ? 409 : /lock/i.test(raw) ? 429 : 502, error: redact(e), gate: null };
    }
  } finally {
    state.running = false;
  }
}
