import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config';
import { listVaults } from '@engine/morphoApi.js';
import { snapshotVault, type VaultSnapshot } from '@engine/snapshot.js';
import type { ChainId } from '@engine/types.js';
import type { Board, BoardVault, VaultView } from '@/lib/types';
import { marketStatus, explorerFor } from '@/lib/format';

const TTL_MS = 60_000;
const TOP_N = Number(process.env.BOARD_TOP_N ?? 8);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 300);

export function toBoardVault(s: VaultSnapshot): BoardVault {
  const markets = s.markets.map((m) => ({
    marketId: m.marketId,
    collateral: m.collateral.symbol,
    oraclePrice: m.oraclePrice,
    marketPrice: m.marketPrice,
    marketPriceSource: m.marketPriceMeta?.source ?? null,
    gapPct: m.gapPct,
    oracleUnchangedFor: m.oracleUnchangedFor,
    fixedByDesign: m.fixedByDesign,
    utilization: m.utilization,
    allocationUsd: m.allocationUsd,
    withdrawableUsd: m.withdrawableUsd,
    liquidityUsd: m.liquidityUsd,
    lltv: m.lltv,
    status: marketStatus(m.gapPct),
    sources: m.sources,
    errors: m.errors,
  }));
  markets.sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
  return {
    address: s.vault.address,
    chainId: s.vault.chainId,
    version: s.vault.version,
    name: s.vault.name,
    curator: s.vault.curatorName,
    curatorAddress: s.vault.curatorAddress,
    tvlUsd: s.vault.totalAssetsUsd,
    apy: s.vault.netApy,
    withdrawableUsd: s.withdrawableUsd,
    idleUsd: s.idleUsd,
    lastCuratorActionAt: s.lastCuratorActionAt,
    lastConfigActionAt: s.lastConfigActionAt,
    lastAllocatorActionAt: s.lastAllocatorActionAt,
    markets,
    openClocks: markets.filter((m) => m.status === 'clock').length,
    error: null,
    sources: s.sources,
    errors: s.errors,
  };
}

export function toVaultView(s: VaultSnapshot): VaultView {
  const ex = explorerFor(s.vault.chainId);
  return {
    ...toBoardVault(s),
    readAt: s.ts,
    curatorEvents: s.curatorEvents.slice(0, 200).map((e) => ({
      kind: e.kind, blockNumber: e.blockNumber, txHash: e.txHash, timestamp: e.timestamp, caller: e.caller, marketId: e.marketId,
      explorer: `${ex}/tx/${e.txHash}`,
    })),
    curatorEventsTotal: s.curatorEventsTotal,
    curatorEventsWindow: s.curatorEventsWindow,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); }
  }));
  return out;
}

async function buildBoard(): Promise<Board> {
  const list = await listVaults(8453, { asset: 'USDC', minTvlUsd: 1_000_000 });
  const top = list.slice(0, TOP_N);
  const vaults = await pool(top, 3, async (v): Promise<BoardVault> => {
    try {
      return toBoardVault(await snapshotVault(8453, v.address));
    } catch (e) {
      return {
        address: v.address, chainId: 8453, version: v.version, name: v.name, curator: v.curatorName, curatorAddress: v.curatorAddress,
        tvlUsd: v.totalAssetsUsd, apy: v.netApy, withdrawableUsd: null, idleUsd: null,
        lastCuratorActionAt: null, lastConfigActionAt: null, lastAllocatorActionAt: null,
        markets: [], openClocks: 0, error: errMsg(e), sources: { vault: 'morpho-api' }, errors: { snapshot: errMsg(e) },
      };
    }
  });
  const markets = vaults.flatMap((v) => v.markets);
  return {
    chainId: 8453,
    readAt: Math.floor(Date.now() / 1000),
    vaults,
    totals: {
      vaults: vaults.length,
      markets: markets.length,
      clocks: markets.filter((m) => m.status === 'clock').length,
      watch: markets.filter((m) => m.status === 'watch').length,
    },
    stale: false,
    error: null,
  };
}

const g = globalThis as unknown as { __lbBoard?: { at: number; board: Board } | null; __lbBoardInflight?: Promise<Board> | null };

function refresh(): Promise<Board> {
  if (!g.__lbBoardInflight) {
    g.__lbBoardInflight = buildBoard()
      .then((b) => { g.__lbBoard = { at: Date.now(), board: b }; persist(b); return b; })
      .finally(() => { g.__lbBoardInflight = null; });
  }
  return g.__lbBoardInflight;
}

const CACHE_FILE = path.join(DATA_DIR, 'cache', 'board.json');
function persist(b: Board) {
  fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).then(() => fs.writeFile(CACHE_FILE, JSON.stringify(b))).catch(() => {});
}
async function fromDisk(): Promise<Board | null> {
  try { return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) as Board; } catch { return null; }
}

/** 60 s cache. Stale results are served while a refresh runs in the background. After a restart, the last board on disk is served as stale (with its real read time) while the first live read runs. */
export async function getBoard(): Promise<Board> {
  const c = g.__lbBoard;
  if (c && Date.now() - c.at < TTL_MS) return c.board;
  if (!c) {
    const live = refresh();
    live.catch(() => {});
    const d = await fromDisk();
    if (!d) return live;
    if (d && Date.now() / 1000 - d.readAt < 6 * 3600) return { ...d, stale: true };
  }
  if (c) {
    refresh().catch(() => {});
    return { ...c.board, stale: true };
  }
  return refresh();
}

export function warmBoard() {
  refresh().catch(() => {});
}

const vaultCache = new Map<string, { at: number; v: VaultView }>();
export async function getVaultView(chainId: ChainId, address: string): Promise<VaultView> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const c = vaultCache.get(key);
  if (c && Date.now() - c.at < TTL_MS) return c.v;
  const v = toVaultView(await snapshotVault(chainId, address));
  vaultCache.set(key, { at: Date.now(), v });
  if (vaultCache.size > 100) vaultCache.delete(vaultCache.keys().next().value!);
  return v;
}
