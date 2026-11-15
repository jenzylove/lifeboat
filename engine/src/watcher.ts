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
import { accountStatus, keeperMove, publicClient, FACTORY_ABI, type AccountStatus } from './keeper.js';
import { stepClock, type ClockState, type CuratorAction, type CuratorActionType, type MarketRead } from './decide/policy.js';
import { decide, type DecisionRecord } from './decide/decide.js';
import type { CandidateVault, Post, SupplyChange } from './decide/evidence.js';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../data');
const STATE_FILE = () => path.join(DATA_DIR, 'state.json');
const DEC_DIR = () => path.join(DATA_DIR, 'decisions');

interface State {
  clocks: Record<string, ClockState>;
  reads: Record<string, MarketRead[]>;
  supply: Record<string, { ts: number; supply: number }[]>;
  lastDecisionAt: Record<string, number>;
  waitUntil: Record<string, number>;
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
    else if (e.kind === 'SetCap' || e.kind === 'SubmitCap') {
      try {
        const rc = await getClient(snap.vault.chainId).getTransactionReceipt({ hash: e.txHash as `0x${string}` });
        const log = rc.logs[e.logIndex - Number(rc.logs[0]?.logIndex ?? 0)] ?? rc.logs.find(l => Number(l.logIndex) === e.logIndex);
        if (log) {
          const d = decodeEventLog({ abi: SETCAP_ABI, data: log.data, topics: log.topics as never });
          const cap = (d.args as { cap: bigint }).cap;
          type = cap === 0n ? 'cap_to_zero' : 'cap_reduced';
          detail = `${e.kind} cap ${cap.toString()}`;
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
async function posts(collateralSymbol: string, curator: string | null): Promise<Post[]> {
  try {
    const r = await fetch('https://forum.morpho.org/latest.json', { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = (await r.json()) as { topic_list?: { topics?: { id: number; slug: string; title: string; last_posted_at: string; created_at: string }[] } };
    const terms = [collateralSymbol.toLowerCase(), ...(curator ? [curator.toLowerCase().split(' ')[0]!] : [])].filter(t => t.length >= 3);
    return (j.topic_list?.topics ?? [])
      .filter(t => terms.some(term => t.title.toLowerCase().includes(term)))
      .slice(0, 5)
      .map(t => ({ ts: Math.floor(Date.parse(t.last_posted_at ?? t.created_at) / 1000), author: 'Morpho forum', where: 'forum.morpho.org', text: t.title, url: `https://forum.morpho.org/t/${t.slug}/${t.id}` }));
  } catch {
    return [];
  }
}

export async function armedAccounts(): Promise<Address[]> {
  const set = new Set<string>();
  if (process.env.HOUSE_ACCOUNT) set.add(process.env.HOUSE_ACCOUNT.toLowerCase());
  const factory = process.env.FACTORY as Address | undefined;
  const fromBlock = process.env.FACTORY_BLOCK ? BigInt(process.env.FACTORY_BLOCK) : undefined;
  if (factory && fromBlock) {
    const latest = await publicClient.getBlockNumber();
    for (let b = fromBlock; b <= latest; b += 40_000n) {
      const to = b + 39_999n > latest ? latest : b + 39_999n;
      const logs = await publicClient.getLogs({ address: factory, event: FACTORY_ABI.find(x => x.type === 'event' && x.name === 'AccountCreated') as never, fromBlock: b, toBlock: to });
      for (const l of logs) set.add(((l as unknown as { args: { account: string } }).args.account).toLowerCase());
    }
  }
  return [...set] as Address[];
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
  const accounts = await armedAccounts();
  res.accounts = accounts.length;
  const snapCache = new Map<string, VaultSnapshot>();
  const snap = async (v: string) => {
    if (!snapCache.has(v)) snapCache.set(v, await snapshotVault(8453, v));
    return snapCache.get(v)!;
  };

  for (const account of accounts) {
    let st: AccountStatus;
    try {
      st = await accountStatus(account);
    } catch (e) {
      res.errors.push(`account ${account}: ${String(e)}`);
      continue;
    }
    const holding = st.positions.filter(p => p.assets > 0.000001);
    for (const pos of holding) {
      let s: VaultSnapshot;
      try {
        s = await snap(pos.vault);
      } catch (e) {
        res.errors.push(`snapshot ${pos.vault}: ${String(e)}`);
        continue;
      }
      for (const m of s.markets) {
        if (!m.allocationUsd || m.allocationUsd <= 0) continue;
        res.markets++;
        const key = `${account}:${pos.vault}:${m.marketId}`.toLowerCase();
        const read: MarketRead = { ts: now, marketId: m.marketId, collateralSymbol: m.collateral.symbol, oraclePrice: m.oraclePrice, marketPrice: m.marketPrice, utilization: m.utilization, exposureUsd: m.allocationUsd };
        const reads = (state.reads[key] ??= []);
        reads.push(read);
        while (reads.length > 60) reads.shift();
        const clock = stepClock(state.clocks[key] ?? { marketId: m.marketId, divergentReads: 0, openedAt: null }, read);
        state.clocks[key] = clock;
        if (clock.openedAt == null) continue;
        res.openClocks++;
        if ((state.waitUntil[key] ?? 0) > now) continue;

        // Candidate vaults: the other approved vaults on this account, with their own open clock count.
        const candidates: CandidateVault[] = [];
        for (const p of st.positions.filter(p => p.allowed && p.vault.toLowerCase() !== pos.vault.toLowerCase())) {
          try {
            const cs = await snap(p.vault);
            const open = cs.markets.filter(x => (x.allocationUsd ?? 0) > 0 && (x.gapPct ?? 0) >= 5).length;
            candidates.push({ address: p.vault, name: cs.vault.name, curator: cs.vault.curatorName ?? 'unknown', apy: cs.vault.netApy, tvlUsd: cs.vault.totalAssetsUsd, openClocks: open });
          } catch (e) {
            res.errors.push(`candidate ${p.vault}: ${String(e)}`);
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
            curatorActions: (await curatorActionsFor(s, m.marketId)).filter(a => a.ts >= clock.openedAt! - 3600),
            supplyChanges: await supplyChanges(state, s, m.collateral.address, m.collateral.decimals, now),
            posts: await posts(m.collateral.symbol, s.vault.curatorName),
            candidates,
            readSource: `snapshotVault: oracle price() onchain, market price ${m.marketPriceMeta?.source ?? 'unavailable'}, Morpho Blue market() onchain`,
          },
          clock,
          'live',
          { withNotice: true },
        );
        state.totals.dolphinCalls++;
        state.totals.inputTokens += record.model?.inputTokens ?? 0;
        state.totals.outputTokens += record.model?.outputTokens ?? 0;
        state.totals.costUsd += record.model?.costUsd ?? 0;
        state.lastDecisionAt[key] = now;
        let tx: unknown = null;
        if (record.decision.action === 'WAIT') state.waitUntil[key] = now + (record.decision.waitMinutes ?? 1) * 60;
        if (record.decision.action === 'LEAVE' && opts.act !== false) {
          const to = record.decision.targetVault;
          try {
            if (!to) throw new Error('no approved vault without an open clock to park in');
            const t = await keeperMove(account, pos.vault as Address, to as Address, record.hash, record.decision.model?.summary ?? record.decision.rule ?? 'leave');
            tx = t;
            res.moves.push({ account, tx: t.explorer });
            state.clocks[key] = { marketId: m.marketId, divergentReads: 0, openedAt: null };
          } catch (e) {
            tx = { error: String(e) };
            res.errors.push(`move ${account}: ${String(e)}`);
          }
        }
        saveDecision({ ...record, account, tx });
        res.decisions.push(record);
      }
    }
  }
  state.totals.cycles++;
  state.heartbeat = { at: now, accounts: res.accounts, markets: res.markets, openClocks: res.openClocks, decisions: res.decisions.length, costUsd: state.totals.costUsd, errors: res.errors.slice(0, 10) };
  saveState(state);
  return res;
}
