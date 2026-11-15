import type { ChainId, TokenRef } from './types.js';

export const MORPHO_API_URL = process.env.MORPHO_API_URL ?? 'https://api.morpho.org/graphql';

export type VaultVersion = 'v1' | 'v2';

export interface VaultSummary {
  version: VaultVersion;
  chainId: ChainId;
  address: string;
  name: string;
  symbol: string;
  asset: TokenRef;
  curatorAddress: string | null;
  curatorName: string | null;
  totalAssetsUsd: number | null;
  netApy: number | null;
}

export interface VaultAllocation {
  marketId: string;
  /** true for the idle market (no collateral, no oracle) */
  isIdle: boolean;
  loanAsset: TokenRef;
  collateralAsset: TokenRef | null;
  oracle: string | null;
  oracleType: string | null;
  /** lltv as a float 0..1, null for idle */
  lltv: number | null;
  /** vault supply in this market, loan token base units (API value, may lag chain by a few blocks) */
  supplyAssets: bigint;
  supplyAssetsUsd: number | null;
  /** v1 only: per-market supply cap (base units). null for v2 (caps live on collateral/adapter ids). */
  supplyCap: bigint | null;
  supplyCapUsd: number | null;
  utilization: number | null;
  liquidityAssets: bigint | null;
  liquidityAssetsUsd: number | null;
  /** v1 only: index in withdraw queue, null if absent */
  withdrawQueueIndex: number | null;
}

export interface VaultDetail extends VaultSummary {
  timelockSeconds: number | null;
  fee: number | null;
  allocations: VaultAllocation[];
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(MORPHO_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string; status?: string }[] };
      if (json.errors?.length) {
        const e = new Error(`Morpho API: ${json.errors.map((x) => x.message).join('; ')}`);
        (e as Error & { notFound?: boolean }).notFound = json.errors.some((x) => x.status === 'NOT_FOUND' || /no results/i.test(x.message));
        if ((e as Error & { notFound?: boolean }).notFound) throw e; // do not retry
        lastErr = e;
      } else if (!res.ok || !json.data) {
        lastErr = new Error(`Morpho API HTTP ${res.status}`);
      } else {
        return json.data;
      }
    } catch (e) {
      if ((e as Error & { notFound?: boolean }).notFound) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw lastErr;
}

const isNotFound = (e: unknown) => !!(e as { notFound?: boolean })?.notFound;

const tok = `address symbol decimals`;
const MARKET = `
  marketId lltv
  loanAsset { ${tok} } collateralAsset { ${tok} }
  oracle { address type }
  state { utilization liquidityAssets liquidityAssetsUsd }`;

interface RawTok { address: string; symbol: string; decimals: number }
type NumStr = number | string;
interface RawMarket {
  marketId: string; lltv: NumStr;
  loanAsset: RawTok; collateralAsset: RawTok | null; oracle: { address: string; type: string } | null;
  state: null | { utilization: number | null; liquidityAssets: NumStr | null; liquidityAssetsUsd: number | null };
}
interface RawCurator { name: string; addresses: { address: string }[] }

const big = (v: NumStr | null | undefined): bigint | null => {
  if (v === null || v === undefined) return null;
  // The API serialises BigInt scalars as JS numbers when small and strings when large.
  return typeof v === 'string' ? BigInt(v) : BigInt(Math.round(v));
};
const tokOf = (t: RawTok): TokenRef => ({ address: t.address, symbol: t.symbol, decimals: Number(t.decimals) });

function pickCurator(addr: string | null, curators: RawCurator[]) {
  const lower = addr?.toLowerCase();
  const hit = curators.find((c) => c.addresses.some((a) => a.address.toLowerCase() === lower)) ?? curators[0];
  return { curatorAddress: addr ?? hit?.addresses[0]?.address ?? null, curatorName: hit?.name ?? null };
}

function allocFrom(
  m: RawMarket, supplyAssets: NumStr | null, supplyAssetsUsd: number | null,
  supplyCap: NumStr | null, supplyCapUsd: number | null, withdrawQueueIndex: number | null,
): VaultAllocation {
  const isIdle = !m.collateralAsset || !m.oracle;
  return {
    marketId: m.marketId, isIdle, loanAsset: tokOf(m.loanAsset),
    collateralAsset: m.collateralAsset ? tokOf(m.collateralAsset) : null,
    oracle: m.oracle?.address ?? null, oracleType: m.oracle?.type ?? null,
    lltv: isIdle ? null : Number(BigInt(m.lltv)) / 1e18,
    supplyAssets: big(supplyAssets) ?? 0n, supplyAssetsUsd,
    supplyCap: big(supplyCap), supplyCapUsd,
    utilization: m.state?.utilization ?? null,
    liquidityAssets: big(m.state?.liquidityAssets), liquidityAssetsUsd: m.state?.liquidityAssetsUsd ?? null,
    withdrawQueueIndex,
  };
}

// ---- v1 ---------------------------------------------------------------
interface RawV1 {
  address: string; name: string; symbol: string; asset: RawTok;
  state: null | {
    totalAssetsUsd: number | null; netApy: number | null; curator: string | null; fee: number | null; timelock: NumStr | null;
    curators: RawCurator[];
    allocation?: {
      supplyAssets: NumStr; supplyAssetsUsd: number | null; supplyCap: NumStr; supplyCapUsd: number | null;
      withdrawQueueIndex: number | null; market: RawMarket;
    }[];
  };
}

function summaryV1(chainId: ChainId, v: RawV1): VaultSummary {
  return {
    version: 'v1', chainId, address: v.address, name: v.name, symbol: v.symbol, asset: tokOf(v.asset),
    ...pickCurator(v.state?.curator ?? null, v.state?.curators ?? []),
    totalAssetsUsd: v.state?.totalAssetsUsd ?? null, netApy: v.state?.netApy ?? null,
  };
}

// ---- v2 ---------------------------------------------------------------
interface RawV2 {
  address: string; name: string; symbol: string; asset: RawTok; totalAssetsUsd: number | null; netApy: number | null;
  curators: { items: RawCurator[] };
  idleAssets?: NumStr; idleAssetsUsd?: number | null;
  adapters?: { items: { address: string; type: string;
    positions?: { items: { market: RawMarket; state: { supplyAssets: NumStr; supplyAssetsUsd: number | null } | null }[] } }[] };
}

function summaryV2(chainId: ChainId, v: RawV2): VaultSummary {
  const c = v.curators.items[0];
  return {
    version: 'v2', chainId, address: v.address, name: v.name, symbol: v.symbol, asset: tokOf(v.asset),
    curatorAddress: c?.addresses[0]?.address ?? null, curatorName: c?.name ?? null,
    totalAssetsUsd: v.totalAssetsUsd, netApy: v.netApy,
  };
}

// ---- public API ---------------------------------------------------------

export interface ListVaultsOpts {
  asset?: string; // symbol e.g. 'USDC'
  minTvlUsd?: number;
  limit?: number; // default 100, per version
  includeV2?: boolean; // default true
}

/** Lists listed vaults (v1 + v2) on a chain, TVL descending. */
export async function listVaults(chainId: ChainId, opts: ListVaultsOpts = {}): Promise<VaultSummary[]> {
  const limit = opts.limit ?? 100;
  const f1 = [`chainId_in: [${chainId}]`, 'listed: true'];
  if (opts.asset) f1.push(`assetSymbol_in: [${JSON.stringify(opts.asset)}]`);
  if (opts.minTvlUsd) f1.push(`totalAssetsUsd_gte: ${opts.minTvlUsd}`);
  const v1 = await gql<{ vaults: { items: RawV1[] } }>(
    `{ vaults(first: ${limit}, orderBy: TotalAssetsUsd, orderDirection: Desc, where: { ${f1.join(', ')} }) {
        items { address name symbol asset { ${tok} } state { totalAssetsUsd netApy curator curators { name addresses { address } } } } } }`,
  );
  const out: VaultSummary[] = v1.vaults.items.map((v) => summaryV1(chainId, v));

  if (opts.includeV2 !== false) {
    // VaultV2sFilters has no asset-symbol filter; filter client side.
    const f2 = [`chainId_in: [${chainId}]`, 'listed: true'];
    if (opts.minTvlUsd) f2.push(`totalAssetsUsd_gte: ${opts.minTvlUsd}`);
    const v2 = await gql<{ vaultV2s: { items: RawV2[] } }>(
      `{ vaultV2s(first: ${limit}, orderBy: TotalAssetsUsd, orderDirection: Desc, where: { ${f2.join(', ')} }) {
          items { address name symbol asset { ${tok} } totalAssetsUsd netApy curators { items { name addresses { address } } } } } }`,
    );
    for (const v of v2.vaultV2s.items) {
      if (opts.asset && v.asset.symbol !== opts.asset) continue;
      out.push(summaryV2(chainId, v));
    }
  }
  return out.sort((a, b) => (b.totalAssetsUsd ?? 0) - (a.totalAssetsUsd ?? 0));
}

/** Fetch one vault with its market allocations (tries v1, then v2). null if neither knows the address. */
export async function getVault(chainId: ChainId, address: string): Promise<VaultDetail | null> {
  const r1 = await gql<{ vaultByAddress: RawV1 | null }>(
    `query($a:String!,$c:Int!){ vaultByAddress(address:$a, chainId:$c){
       address name symbol asset { ${tok} }
       state { totalAssetsUsd netApy curator fee timelock curators { name addresses { address } }
         allocation { supplyAssets supplyAssetsUsd supplyCap supplyCapUsd withdrawQueueIndex market { ${MARKET} } } } } }`,
    { a: address, c: chainId },
  ).catch((e: unknown) => { if (isNotFound(e)) return null; throw e; });
  const v1 = r1?.vaultByAddress;
  if (v1?.state) {
    return {
      ...summaryV1(chainId, v1),
      timelockSeconds: v1.state.timelock === null ? null : Number(v1.state.timelock),
      fee: v1.state.fee,
      allocations: (v1.state.allocation ?? []).map((a) =>
        allocFrom(a.market, a.supplyAssets, a.supplyAssetsUsd, a.supplyCap, a.supplyCapUsd, a.withdrawQueueIndex)),
    };
  }
  const r2 = await gql<{ vaultV2ByAddress: RawV2 | null }>(
    `query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){
       address name symbol asset { ${tok} } totalAssetsUsd netApy curators { items { name addresses { address } } }
       idleAssets idleAssetsUsd
       adapters(first: 10) { items { address type ... on MorphoMarketV1Adapter { positions(first: 100) { items {
         market { ${MARKET} } state { supplyAssets supplyAssetsUsd } } } } } } } }`,
    { a: address, c: chainId },
  ).catch((e: unknown) => { if (isNotFound(e)) return null; throw e; });
  const v2 = r2?.vaultV2ByAddress;
  if (!v2) return null;
  const allocations: VaultAllocation[] = [];
  for (const ad of v2.adapters?.items ?? []) {
    for (const p of ad.positions?.items ?? []) {
      if ((big(p.state?.supplyAssets) ?? 0n) === 0n) continue;
      allocations.push(allocFrom(p.market, p.state!.supplyAssets, p.state!.supplyAssetsUsd, null, null, null));
    }
  }
  const idle = big(v2.idleAssets) ?? 0n;
  if (idle > 0n) {
    allocations.push({
      marketId: 'v2-idle', isIdle: true, loanAsset: tokOf(v2.asset), collateralAsset: null, oracle: null, oracleType: null,
      lltv: null, supplyAssets: idle, supplyAssetsUsd: v2.idleAssetsUsd ?? null, supplyCap: null, supplyCapUsd: null,
      utilization: 0, liquidityAssets: idle, liquidityAssetsUsd: v2.idleAssetsUsd ?? null, withdrawQueueIndex: null,
    });
  }
  return { ...summaryV2(chainId, v2), timelockSeconds: null, fee: null, allocations };
}
