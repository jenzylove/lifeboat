import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Address } from 'viem';
import { runDrill, accountStatus } from '@engine/keeper.js';
import { houseEvents } from './house';
import { DATA_DIR } from './config';

export const DRILL_WINDOW_S = 10 * 60;

const g = globalThis as unknown as { __lbDrill?: { lastAt: number; running: boolean } };
const state = (g.__lbDrill ??= { lastAt: 0, running: false });

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
  const gate = await drillGate(account);
  if (!gate.allowed) return { ok: false as const, status: 429, error: gate.reason!, gate };
  state.running = true;
  state.lastAt = Math.floor(Date.now() / 1000);
  try {
    const before = await accountStatus(account);
    const record = {
      kind: 'fire_drill',
      version: 1,
      at: state.lastAt,
      account,
      requester: createHash('sha256').update(`${ip}:${process.env.DRILL_SALT ?? 'lifeboat'}`).digest('hex').slice(0, 16),
      before: { total: before.total, idle: before.idle, positions: before.positions.map((p) => ({ vault: p.vault, assets: p.assets })) },
    };
    const recordHash = '0x' + createHash('sha256').update(JSON.stringify(record)).digest('hex');
    const r = await runDrill(account, recordHash);
    const out = { record, recordHash, tx: { ...r.tx, block: Number(r.tx.block) }, from: r.from, to: r.to, before: r.before, after: r.after };
    try {
      const dir = path.join(DATA_DIR, 'drills');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${record.at}-${recordHash.slice(2, 10)}.json`), JSON.stringify(out, null, 2));
    } catch {}
    return { ok: true as const, ...out };
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0]!;
    // A failed send did not move money; reopen the window unless the chain may have the tx.
    if (/KEEPER_PK not set|holds nothing|no second approved/i.test(msg)) state.lastAt = 0;
    return { ok: false as const, status: /KEEPER_PK|holds nothing|no second/i.test(msg) ? 409 : 502, error: msg, gate };
  } finally {
    state.running = false;
  }
}
