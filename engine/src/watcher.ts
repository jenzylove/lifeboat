/**
 * The watcher: every cycle, for every armed Lifeboat account, read each vault it holds,
 * run the clock per market, ask Dolphin when a clock is open, clamp, and act.
 * State and decision records are JSON files under DATA_DIR so anyone can audit them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, parseAbi, type Address } from 'viem';
import { snapshotVault, type VaultSnapshot } from './snapshot.js';
import { getClient } from './onchain.js';
import { accountStatus, keeperMove, keeperExit, publicClient, FACTORY_ABI, type AccountStatus } from './keeper.js';
import { stepClock, openRelated, type ClockState, type CuratorAction, type CuratorActionType, type MarketRead } from './decide/policy.js';
import { decide, noticeAfterTx, type DecisionRecord } from './decide/decide.js';
import type { CandidateVault, Post, SupplyChange } from './decide/evidence.js';
import { sweep, type Break, type GuardedMarket } from './decide/sweep.js';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../data');
const STATE_FILE = () => path.join(DATA_DIR, 'state.json');
const DEC_DIR = () => path.join(DATA_DIR, 'decisions');

interface State {
  clocks: Record<string, ClockState>;
  reads: Record<string, MarketRead[]>;
  supply: Record<string, { ts: number; supply: number }[]>;
  lastDecisionAt: Record<string, number>;
  waitUntil: Record<string, number>;
  lastSweepKey?: string;
  scanned?: { block: string; accounts: string[] };
  names?: Record<string, string>;
  related?: Record<string, { ts: number; related_to: string[]; reason: string }>;
  heartbeat: { at: number; accounts: number; markets: number; openClocks: number; decisions: number; costUsd: number; errors: string[] } | null;
  totals: { cycles: number; dolphinCalls: number; inputTokens: number; outputTokens: number; costUsd: number };
}

const empty = (): State => ({ clocks: {}, reads: {}, supply: {}, lastDecisionAt: {}, waitUntil: {}, heartbeat: null, totals: { cycles: 0, dolphinCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } });

export function loadState(): State {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) };
  } catch {
    return empty();
  }
}
function saveState(s: State) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE() + '.tmp', JSON.stringify(s));
  fs.renameSync(STATE_FILE() + '.tmp', STATE_FILE());
}
export function saveDecision(r: DecisionRecord & { tx?: unknown; account?: string }) {
  fs.mkdirSync(DEC_DIR(), { recursive: true });
  fs.writeFileSync(path.join(DEC_DIR(), `${r.at}-${r.hash.slice(2, 12)}.json`), JSON.stringify(r, null, 1));
}

/** Errors leave this process only as one line with URLs removed (an RPC URL can carry a key). */
export function redact(e: unknown): string {
  const first = String(e instanceof Error ? e.message : e).split('\n')[0] ?? '';
  return first.replace(/https?:\/\/\S+/g, '[rpc]').slice(0, 240);
}

/** Text from outside sources goes into prompts and onchain strings only after this. */
const clean = (t: string, n = 200) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

const SETCAP_ABI = parseAbi(['event SetCap(address indexed caller, bytes32 indexed id, uint256 cap)']);
const REALLOC_ABI = parseAbi(['event ReallocateWithdraw(address indexed caller, bytes32 indexed id, uint256 withdrawnAssets, uint256 withdrawnShares)']);

/** Turn raw curator events for one market into typed actions. SetCap is decoded to tell a cut to zero from a raise. */
export async function curatorActionsFor(snap: VaultSnapshot, marketId: string): Promise<CuratorAction[]> {
  const out: CuratorAction[] = [];
  const evs = snap.curatorEvents.filter(e => e.marketId?.toLowerCase() === marketId.toLowerCase() || e.kind === 'SetSupplyQueue' || e.kind === 'SetWithdrawQueue');
  for (const e of evs) {
    if (e.timestamp == null) continue;
    let type: CuratorActionType = 'other';
    let detail = e.kind;
    if (e.kind === 'SubmitMarketRemoval') type = 'removal_submitted';
    else if (e.kind === 'ReallocateWithdraw') type = 'reallocate_away';
    else if (e.kind === 'ReallocateSupply') type = 'reallocate_into';
    else if (e.kind === 'SetSupplyQueue' || e.kind === 'SetWithdrawQueue') type = 'queue_change';
    else if (e.kind === 'SubmitCap') detail = 'cap change submitted (pending timelock)';
    else if (e.kind === 'SetCap') {
      try {
        const rc = await getClient(snap.vault.chainId).getTransactionReceipt({ hash: e.txHash as `0x${string}` });
        const log = rc.logs[e.logIndex - Number(rc.logs[0]?.logIndex ?? 0)] ?? rc.logs.find(l => Number(l.logIndex) === e.logIndex);
        if (log) {
          const d = decodeEventLog({ abi: SETCAP_ABI, data: log.data, topics: log.topics as never });
          const cap = (d.args as { cap: bigint }).cap;
          // Only a cut to zero is known to be protective; any other value could be a raise.
          type = cap === 0n ? 'cap_to_zero' : 'other';
          detail = `${e.kind} cap set to ${cap.toString()}`;
        }
      } catch {
        type = 'other';
      }
    }
    out.push({ ts: e.timestamp, type, marketId, tx: e.txHash, detail });
  }
  void REALLOC_ABI;
  return out.sort((a, b) => a.ts - b.ts);
}

const ERC20_SUPPLY = parseAbi(['function totalSupply() view returns (uint256)']);

/** Track collateral token total supply; a sudden jump is how unbacked minting shows up first. */
async function supplyChanges(state: State, snap: VaultSnapshot, collateral: string, decimals: number, now: number): Promise<SupplyChange[]> {
  const key = `${snap.vault.chainId}:${collateral.toLowerCase()}`;
  try {
    const raw = await getClient(snap.vault.chainId).readContract({ address: collateral as Address, abi: ERC20_SUPPLY, functionName: 'totalSupply' });
    const s = Number(raw) / 10 ** decimals;
    const hist = (state.supply[key] ??= []);
    if (!hist.length || now - hist[hist.length - 1]!.ts >= 300) hist.push({ ts: now, supply: s });
    while (hist.length > 300) hist.shift();
    const hourAgo = [...hist].reverse().find(h => now - h.ts >= 3600) ?? hist[0]!;
    const delta = hourAgo.supply > 0 ? (s - hourAgo.supply) / hourAgo.supply : 0;
    if (Math.abs(delta) >= 0.05) return [{ ts: now, token: collateral, deltaPct: delta, detail: `total supply ${hourAgo.supply.toFixed(0)} -> ${s.toFixed(0)} since ${new Date(hourAgo.ts * 1000).toISOString()}`, source: 'totalSupply() onchain' }];
  } catch {
    /* unreadable supply is just absent evidence */
  }
  return [];
}

/** Public posts: Morpho governance forum latest topics mentioning the collateral or the curator. */
export async function posts(collateralSymbol: string, curator: string | null): Promise<Post[]> {
  try {
    const r = await fetch('https://forum.morpho.org/latest.json', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { topic_list?: { topics?: { id: number; slug: string; title: string; last_posted_at: string; created_at: string }[] } };
    const terms = [collateralSymbol.toLowerCase(), ...(curator ? [curator.toLowerCase().split(' ')[0]!] : [])].filter(t => t.length >= 3);
    return (j.topic_list?.topics ?? [])
      .filter(t => terms.some(term => t.title.toLowerCase().includes(term)))
      .slice(0, 5)
      .map(t => ({ ts: Math.floor(Date.parse(t.last_posted_at ?? t.created_at) / 1000), author: 'Morpho forum', where: 'forum.morpho.org', text: clean(t.title), url: `https://forum.morpho.org/t/${t.slug}/${t.id}` }));
  } catch {
    return [];
  }
}

/** Accounts to guard: the house boat plus every account the factory created. Scans only new blocks; a failed scan keeps the known list. */
/** The newest Morpho forum topics: outside text Lifeboat reads on every on demand check (screened by SERV first). */
export async function latestForumTopics(n = 5): Promise<Post[]> {
  try {
    const r = await fetch('https://forum.morpho.org/latest.json', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { topic_list?: { topics?: { id: number; slug: string; title: string; last_posted_at: string; created_at: string }[] } };
    return (j.topic_list?.topics ?? []).slice(0, n).map(t => ({ ts: Math.floor(Date.parse(t.last_posted_at ?? t.created_at) / 1000), author: 'Morpho forum', where: 'forum.morpho.org', text: clean(t.title), url: `https://forum.morpho.org/t/${t.slug}/${t.id}` }));
  } catch {
    return [];
  }
}

export async function armedAccounts(state?: State, errors?: string[]): Promise<Address[]> {
  const set = new Set<string>(state?.scanned?.accounts ?? []);
  if (process.env.HOUSE_ACCOUNT) set.add(process.env.HOUSE_ACCOUNT.toLowerCase());
  const factory = process.env.FACTORY as Address | undefined;
  const startBlock = process.env.FACTORY_BLOCK ? BigInt(process.env.FACTORY_BLOCK) : undefined;
  if (factory && startBlock) {
    try {
      const latest = await publicClient.getBlockNumber();
      let b = state?.scanned ? BigInt(state.scanned.block) + 1n : startBlock;
      for (; b <= latest; b += 40_000n) {
        const to = b + 39_999n > latest ? latest : b + 39_999n;
        const logs = await publicClient.getLogs({ address: factory, event: FACTORY_ABI.find(x => x.type === 'event' && x.name === 'AccountCreated') as never, fromBlock: b, toBlock: to });
        for (const l of logs) set.add(((l as unknown as { args: { account: string } }).args.account).toLowerCase());
        if (state) state.scanned = { block: to.toString(), accounts: [...set] };
      }
    } catch (e) {
      errors?.push(`factory scan: ${redact(e)}`);
    }
  }
  return [...set] as Address[];
}

const NAME_ABI = parseAbi(['function name() view returns (string)']);
async function tokenName(state: State, address: string, symbol: string): Promise<string> {
  const names = (state.names ??= {});
  const k = address.toLowerCase();
  if (names[k]) return names[k]!;
  try {
    names[k] = await getClient(8453).readContract({ address: address as Address, abi: NAME_ABI, functionName: 'name' });
  } catch {
    names[k] = symbol;
  }
  return names[k]!;
}

/** Breaks seen by the app's board scan of the top Base vaults (data/cache/board.json), so the sweep sees beyond the vaults we hold. */
function boardBreaks(now: number): Break[] {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cache', 'board.json'), 'utf8'));
    const vaults = b.vaults ?? b.data?.vaults ?? [];
    const out: Break[] = [];
    for (const v of vaults) for (const m of v.markets ?? []) {
      if ((m.gapPct ?? 0) < 5) continue;
      const sym = typeof m.collateral === 'string' ? m.collateral : m.collateral?.symbol ?? '?';
      out.push({ marketId: m.marketId, collateralSymbol: sym, collateralName: (typeof m.collateral === 'object' && m.collateral?.name) || sym, collateralAddress: (typeof m.collateral === 'object' && m.collateral?.address) || '', gapPct: m.gapPct, since: now, where: `Morpho Base, vault ${v.name ?? ''} (board scan read ${b.readAt ?? 'unknown'})` });
    }
    return out;
  } catch {
    return [];
  }
}

export interface CycleResult {
  at: number;
  accounts: number;
  markets: number;
  openClocks: number;
  decisions: DecisionRecord[];
  moves: { account: string; tx: string }[];
  errors: string[];
}

export async function cycle(opts: { act?: boolean; now?: number } = {}): Promise<CycleResult> {
  const state = loadState();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const res: CycleResult = { at: now, accounts: 0, markets: 0, openClocks: 0, decisions: [], moves: [], errors: [] };
  const accounts = await armedAccounts(state, res.errors);
  res.accounts = accounts.length;
  const snapCache = new Map<string, VaultSnapshot>();
  const guarded: (GuardedMarket & { key: string })[] = [];
  const ownBreaks: Break[] = [];
  const snap = async (v: string) => {
    // One day of curator history is plenty for a clock measured in minutes, and keeps RPC load low.
    if (!snapCache.has(v)) snapCache.set(v, await snapshotVault(8453, v, { curatorLookbackBlocks: 43_200 }));
    return snapCache.get(v)!;
  };

  for (const account of accounts) {
    let st: AccountStatus;
    try {
      st = await accountStatus(account);
    } catch (e) {
      res.errors.push(`account ${account}: ${redact(e)}`);
      continue;
    }
    if (st.paused) continue; // the owner paused the agent: no model calls, no transactions
    const holding = st.positions.filter(p => p.assets > 0.000001);
    for (const pos of holding) {
      let s: VaultSnapshot;
      try {
        s = await snap(pos.vault);
      } catch (e) {
        res.errors.push(`snapshot ${pos.vault}: ${redact(e)}`);
        continue;
      }
      let movedOut = false;
      for (const m of s.markets) {
        if (movedOut) break; // the whole position already left this vault this cycle
        if (!m.allocationUsd || m.allocationUsd <= 0) continue;
        res.markets++;
        const key = `${account}:${pos.vault}:${m.marketId}`.toLowerCase();
        const read: MarketRead = { ts: now, marketId: m.marketId, collateralSymbol: m.collateral.symbol, oraclePrice: m.oraclePrice, marketPrice: m.marketPrice, utilization: m.utilization, exposureUsd: m.allocationUsd };
        const reads = (state.reads[key] ??= []);
        reads.push(read);
        while (reads.length > 60) reads.shift();
        const clock = stepClock(state.clocks[key] ?? { marketId: m.marketId, divergentReads: 0, openedAt: null }, read);
        state.clocks[key] = clock;
        guarded.push({ key, marketId: m.marketId, collateralSymbol: m.collateral.symbol, collateralName: await tokenName(state, m.collateral.address, m.collateral.symbol), collateralAddress: m.collateral.address, vaultName: s.vault.name, exposureUsd: m.allocationUsd });
        if (clock.openedAt != null && clock.kind === 'gap') ownBreaks.push({ marketId: m.marketId, collateralSymbol: m.collateral.symbol, collateralName: await tokenName(state, m.collateral.address, m.collateral.symbol), collateralAddress: m.collateral.address, gapPct: (m.gapPct ?? 0), since: clock.openedAt, where: `Morpho Base, vault ${s.vault.name}` });
        if (clock.openedAt == null) continue;
        res.openClocks++;
        const waiting = (state.waitUntil[key] ?? 0) > now;
        const curatorUnknown = Boolean(s.errors.curatorEvents);

        // Candidate vaults: the other approved vaults on this account, with their own open clock count.
        const candidates: CandidateVault[] = [];
        for (const p of st.positions.filter(p => p.allowed && p.vault.toLowerCase() !== pos.vault.toLowerCase())) {
          try {
            const cs = await snap(p.vault);
            const open = cs.markets.filter(x => (x.allocationUsd ?? 0) > 0 && (x.gapPct ?? 0) >= 5).length;
            candidates.push({ address: p.vault, name: cs.vault.name, curator: cs.vault.curatorName ?? 'unknown', apy: cs.vault.netApy, tvlUsd: cs.vault.totalAssetsUsd, openClocks: open });
          } catch (e) {
            res.errors.push(`candidate ${p.vault}: ${redact(e)}`);
          }
        }
        const record = await decide(
          {
            user: { vault: pos.vault, vaultName: s.vault.name, curator: s.vault.curatorName ?? 'unknown', positionUsd: pos.assets, withdrawableUsd: pos.withdrawable },
            marketId: m.marketId,
            collateral: m.collateral.symbol,
            clockOpenedAt: clock.openedAt,
            now,
            reads: reads.filter(r => r.ts >= clock.openedAt! - 3600),
            curatorActions: curatorUnknown ? [] : (await curatorActionsFor(s, m.marketId)).filter(a => a.ts >= clock.openedAt! - 3600),
            curatorUnknown,
            supplyChanges: await supplyChanges(state, s, m.collateral.address, m.collateral.decimals, now),
            posts: await posts(m.collateral.symbol, s.vault.curatorName),
            candidates,
            related: [
              ...(clock.kind === 'related' && state.related?.[key] ? [{ ts: state.related[key]!.ts, text: `Sweep linked this market's collateral ${m.collateral.symbol} to ${state.related[key]!.related_to.join(', ')}, which is breaking: ${clean(state.related[key]!.reason, 300)}`, source: 'Lifeboat sweep' }] : []),
              ...(m.fixedByDesign ? [{ ts: now, text: 'This market oracle price has not changed in 7 days of samples: it is likely a fixed rate feed by design, so a small steady gap can be normal; judge whether the gap is moving.', source: 'oracle price() history onchain' }] : []),
              ...(curatorUnknown ? [{ ts: now, text: 'The curator history could not be read this cycle (RPC error). Curator silence is UNKNOWN, not confirmed.', source: 'lifeboat' }] : []),
            ],
            readSource: `snapshotVault: oracle price() onchain, market price ${m.marketPriceMeta?.source ?? 'unavailable'}, Morpho Blue market() onchain`,
          },
          clock,
          'live',
          { skipModel: waiting, curatorUnknown },
        );
        state.totals.dolphinCalls++;
        state.totals.inputTokens += record.model?.inputTokens ?? 0;
        state.totals.outputTokens += record.model?.outputTokens ?? 0;
        state.totals.costUsd += record.model?.costUsd ?? 0;
        state.lastDecisionAt[key] = now;
        const d = record.decision;
        // Track how long the model has been unavailable for this clock (drives the fallback rule).
        if (!waiting) state.clocks[key] = { ...clock, modelFailSince: d.modelError ? (clock.modelFailSince ?? now) : null };
        let tx: unknown = null;
        let notice: Awaited<ReturnType<typeof noticeAfterTx>> = null;
        if (d.action === 'WAIT' && !waiting) state.waitUntil[key] = now + (d.waitMinutes ?? 1) * 60;
        if (d.action === 'STAY') {
          // Back off on a STAY so a steady benign gap is not asked again every minute; a related clock closes on STAY.
          state.waitUntil[key] = now + 10 * 60;
          if (clock.kind === 'related') state.clocks[key] = { marketId: m.marketId, divergentReads: 0, openedAt: null };
        }
        if (d.action === 'LEAVE' && opts.act !== false) {
          const to = d.targetVault;
          const reason = clean(d.model?.summary ?? d.rule ?? 'leave');
          let ok = false;
          try {
            // No approved vault without an open clock: still get out, into the account itself (only the owner can withdraw from there).
            const t = to ? await keeperMove(account, pos.vault as Address, to as Address, record.hash, reason) : await keeperExit(account, pos.vault as Address, record.hash, reason);
            tx = t;
            ok = t.status === 'success';
            if (ok) {
              res.moves.push({ account, tx: t.explorer });
              state.clocks[key] = { marketId: m.marketId, divergentReads: 0, openedAt: null };
              movedOut = true;
            }
          } catch (e) {
            tx = { error: redact(e) };
            res.errors.push(`move ${account}: ${redact(e)}`);
          }
          const toName = to ? candidates.find(c => c.address.toLowerCase() === to.toLowerCase())?.name ?? null : null;
          notice = await noticeAfterTx(
            { action: to ? 'LEAVE' : 'EXIT', fromName: s.vault.name, toName, tx: { ok, explorer: (tx as { explorer?: string } | null)?.explorer, error: (tx as { error?: string } | null)?.error }, mode: 'live' },
            [...(d.rule ? [`Safety rule: ${d.rule.replace(/_/g, ' ')}`] : []), ...(d.model?.reasons ?? []).map(r => r.claim)],
          );
        }
        saveDecision({ ...record, notice, account, tx });
        res.decisions.push(record);
      }
    }
  }
  // The sweep: when the set of live breaks changes, one model call checks every guarded market for a hidden link.
  const breaks = [...ownBreaks, ...boardBreaks(now)];
  const sweepKey = breaks.map(b => b.marketId).sort().join('|');
  if (breaks.length && guarded.length && sweepKey !== state.lastSweepKey) {
    const uniq = [...new Map(guarded.map(g => [g.marketId.toLowerCase(), g])).values()];
    const sw = await sweep(uniq, breaks, now);
    state.totals.dolphinCalls++;
    state.totals.inputTokens += sw.model?.inputTokens ?? 0;
    state.totals.outputTokens += sw.model?.outputTokens ?? 0;
    state.totals.costUsd += sw.model?.costUsd ?? 0;
    fs.mkdirSync(path.join(DATA_DIR, 'sweeps'), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'sweeps', `${now}.json`), JSON.stringify({ at: now, breaks, guarded: uniq.length, ...sw }, null, 1));
    for (const f of sw.flags) for (const g of guarded) if (g.marketId.toLowerCase() === f.marketId.toLowerCase()) {
      state.clocks[g.key] = openRelated(state.clocks[g.key] ?? { marketId: g.marketId, divergentReads: 0, openedAt: null }, now, f.related_to);
      (state.related ??= {})[g.key] = { ts: now, related_to: f.related_to, reason: f.reason };
    }
    if (sw.error) res.errors.push(`sweep: ${redact(sw.error)}`);
    else state.lastSweepKey = sweepKey; // a failed sweep is retried next cycle
  }
  if (!breaks.length) state.lastSweepKey = '';
  state.totals.cycles++;
  state.heartbeat = { at: now, accounts: res.accounts, markets: res.markets, openClocks: res.openClocks, decisions: res.decisions.length, costUsd: state.totals.costUsd, errors: res.errors.slice(0, 10) };
  saveState(state);
  return res;
}
