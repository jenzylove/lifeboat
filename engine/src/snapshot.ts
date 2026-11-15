import { getVault, type VaultAllocation, type VaultDetail } from './morphoApi.js';
import { readMarket, readOraclePrice, readVaultPosition, type MarketState } from './onchain.js';
import { getMarketPrice, llamaUsdPrice } from './marketPrice.js';
import { oracleStaleness, type ChangeBucket } from './oracleStaleness.js';
import { fetchCuratorEvents, type CuratorEvent } from './curatorEvents.js';
import { gapPct as calcGap, toFloat, withdrawable } from './math.js';
import { type ChainId, type TokenRef } from './types.js';

export interface MarketSnapshot {
  marketId: string;
  collateral: TokenRef;
  loan: TokenRef;
  oracle: string;
  oracleType: string | null;
  lltv: number | null;
  /** oracle price of 1 collateral token in loan tokens */
  oraclePrice: number | null;
  /** secondary market price of 1 collateral token in loan tokens */
  marketPrice: number | null;
  marketPriceMeta: { source: string; timestamp: number; confidence: number | null } | null;
  /** (oracle - market) / market * 100. Positive = oracle above market (lender-unsafe direction). */
  gapPct: number | null;
  oracleUnchangedFor: ChangeBucket | null;
  fixedByDesign: boolean | null;
  utilization: number | null;
  /** market liquidity (supply - borrow) in USD */
  liquidityUsd: number | null;
  /** vault's position in this market in USD */
  allocationUsd: number | null;
  /** vault's position in loan tokens */
  allocationAssets: number | null;
  /** min(vault position, market liquidity) in USD */
  withdrawableUsd: number | null;
  /** supply cap in loan tokens / USD (v1 only; null for v2 where caps are collateral/adapter level) */
  cap: number | null;
  capUsd: number | null;
  /** which source produced each field */
  sources: Record<string, string>;
  /** explicit error per field that could not be sourced */
  errors: Record<string, string>;
}

export interface VaultSnapshot {
  vault: {
    address: string; chainId: ChainId; version: 'v1' | 'v2'; name: string; symbol: string; asset: TokenRef;
    curatorName: string | null; curatorAddress: string | null; totalAssetsUsd: number | null; netApy: number | null;
  };
  ts: number;
  markets: MarketSnapshot[];
  idleUsd: number | null;
  withdrawableUsd: number | null;
  lastCuratorActionAt: number | null;
  lastConfigActionAt: number | null;
  lastAllocatorActionAt: number | null;
  curatorEventsTotal: number;
  curatorEvents: CuratorEvent[];
  /** 'no events in window' is lastCuratorActionAt=null with no error */
  curatorEventsWindow: { fromBlock: number; toBlock: number; lookbackSeconds: number } | null;
  sources: Record<string, string>;
  errors: Record<string, string>;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]!);
    }
  }));
  return out;
}

async function snapshotMarket(
  chainId: ChainId, v: VaultDetail, a: VaultAllocation, usdPerLoan: number | null, usdSource: string,
): Promise<MarketSnapshot> {
  const collateral = a.collateralAsset!;
  const loan = a.loanAsset;
  const sources: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const usd = (loanTokens: number | null) => (loanTokens === null || usdPerLoan === null ? null : loanTokens * usdPerLoan);

  const [oracleR, mktR, stalenessR] = await Promise.all([
    readOraclePrice(chainId, a.oracle!, loan.decimals, collateral.decimals).then((x) => ({ ok: true as const, ...x }), (e: Error) => ({ ok: false as const, error: e.message.split('\n')[0]! })),
    readMarket(chainId, a.marketId).then((x) => ({ ok: true as const, x }), (e: Error) => ({ ok: false as const, error: e.message.split('\n')[0]! })),
    oracleStaleness(chainId, a.oracle!),
  ]);

  let oraclePrice: number | null = null;
  if (oracleR.ok) { oraclePrice = oracleR.price; sources.oraclePrice = `onchain:${a.oracle}.price()`; }
  else errors.oraclePrice = oracleR.error;

  const mp = await getMarketPrice(chainId, collateral, loan, oraclePrice ? { hintPrice: oraclePrice } : {});
  let marketPrice: number | null = null;
  let marketPriceMeta: MarketSnapshot['marketPriceMeta'] = null;
  if (mp.ok) {
    marketPrice = mp.value.price;
    marketPriceMeta = { source: mp.value.source, timestamp: mp.value.timestamp, confidence: mp.value.confidence };
    sources.marketPrice = mp.value.source;
  } else errors.marketPrice = mp.error;

  let gap: number | null = null;
  if (oraclePrice !== null && marketPrice !== null) { gap = calcGap(oraclePrice, marketPrice); sources.gapPct = 'computed(oraclePrice, marketPrice)'; }
  else errors.gapPct = 'needs both oraclePrice and marketPrice';

  let unchanged: ChangeBucket | null = null;
  let fixed: boolean | null = null;
  if (stalenessR.ok) {
    unchanged = stalenessR.value.lastChangeAgo; fixed = stalenessR.value.fixedByDesign;
    sources.oracleUnchangedFor = stalenessR.source; sources.fixedByDesign = stalenessR.source;
    if (unchanged === 'unknown') errors.oracleUnchangedFor = 'historical oracle reads unavailable (archive RPC)';
  } else { errors.oracleUnchangedFor = stalenessR.error; errors.fixedByDesign = stalenessR.error; }

  // Market state + vault position: on chain.
  let m: MarketState | null = null;
  let utilization: number | null = a.utilization;
  let liquidityAssets: bigint | null = a.liquidityAssets;
  if (mktR.ok) {
    m = mktR.x; utilization = m.utilization; liquidityAssets = m.liquidity;
    sources.utilization = sources.liquidityUsd = `onchain:morpho.market(${a.marketId})`;
  } else {
    errors.onchainMarket = mktR.error;
    if (utilization !== null) sources.utilization = sources.liquidityUsd = 'morpho-api (on-chain read failed)';
  }

  // Position: v1 vault holds the position directly; for v2 the adapter holds it, so use the API figure.
  let positionAssets: bigint = a.supplyAssets;
  sources.allocationUsd = 'morpho-api';
  if (v.version === 'v1' && m) {
    try {
      positionAssets = await readVaultPosition(chainId, a.marketId, v.address, m);
      sources.allocationUsd = `onchain:morpho.position(${a.marketId}, vault)`;
    } catch (e) { errors.onchainPosition = (e as Error).message.split('\n')[0]!; }
  }
  const allocationAssets = toFloat(positionAssets, loan.decimals);
  const liqTokens = liquidityAssets === null ? null : toFloat(liquidityAssets, loan.decimals);
  const wd = liquidityAssets === null ? null : toFloat(withdrawable([{ positionAssets, liquidity: liquidityAssets }]), loan.decimals);

  const capTokens = a.supplyCap === null ? null : toFloat(a.supplyCap, loan.decimals);
  if (capTokens !== null) sources.cap = 'morpho-api';
  if (usdPerLoan === null) errors.usd = 'no USD price for loan token';
  else sources.usd = usdSource;

  return {
    marketId: a.marketId, collateral, loan, oracle: a.oracle!, oracleType: a.oracleType, lltv: a.lltv,
    oraclePrice, marketPrice, marketPriceMeta, gapPct: gap, oracleUnchangedFor: unchanged, fixedByDesign: fixed,
    utilization, liquidityUsd: usd(liqTokens), allocationUsd: usd(allocationAssets), allocationAssets,
    withdrawableUsd: usd(wd), cap: capTokens, capUsd: usd(capTokens), sources, errors,
  };
}

export interface SnapshotOpts {
  curatorLookbackBlocks?: number;
  marketConcurrency?: number;
  skipCuratorEvents?: boolean;
}

/** Full live snapshot of one vault. Never fabricates: unsourced fields are null with an entry in `errors`. */
export async function snapshotVault(chainId: ChainId, vaultAddress: string, opts: SnapshotOpts = {}): Promise<VaultSnapshot> {
  const v = await getVault(chainId, vaultAddress);
  if (!v) throw new Error(`Vault ${vaultAddress} not found on chain ${chainId} (Morpho API, v1 or v2)`);
  const sources: Record<string, string> = { vault: 'morpho-api' };
  const errors: Record<string, string> = {};

  // USD per loan token: DefiLlama, else derived from the API's own USD valuation.
  let usdPerLoan: number | null = null;
  let usdSource = '';
  const loanUsd = await llamaUsdPrice(chainId, v.asset.address);
  if (loanUsd) { usdPerLoan = loanUsd; usdSource = 'defillama'; }
  else {
    const ref = v.allocations.find((x) => x.supplyAssets > 0n && x.supplyAssetsUsd);
    if (ref) { usdPerLoan = ref.supplyAssetsUsd! / toFloat(ref.supplyAssets, ref.loanAsset.decimals); usdSource = 'morpho-api (derived)'; }
  }

  const nonIdle = v.allocations.filter((a) => !a.isIdle);
  const idleAllocs = v.allocations.filter((a) => a.isIdle);
  const markets = await pool(nonIdle, opts.marketConcurrency ?? 3, (a) => snapshotMarket(chainId, v, a, usdPerLoan, usdSource));

  // Idle: v1 idle market is a Morpho market with no collateral; position read on chain.
  let idleTokens = 0;
  let idleWd = 0n;
  for (const a of idleAllocs) {
    let pos = a.supplyAssets;
    if (v.version === 'v1') {
      try { pos = await readVaultPosition(chainId, a.marketId, v.address); sources.idleUsd = 'onchain:morpho.position(idle market)'; }
      catch (e) { errors.idleOnchain = (e as Error).message.split('\n')[0]!; sources.idleUsd = 'morpho-api'; }
    } else sources.idleUsd = 'morpho-api';
    idleTokens += toFloat(pos, a.loanAsset.decimals);
    idleWd += pos;
  }
  const usd = (t: number) => (usdPerLoan === null ? null : t * usdPerLoan);
  if (usdPerLoan === null) errors.usd = 'no USD price for loan token';
  if (idleAllocs.length === 0) sources.idleUsd = 'morpho-api (vault has no idle market allocation)';

  const wdTokens = markets.reduce((s, m) => s + (m.withdrawableUsd === null || usdPerLoan === null ? 0 : m.withdrawableUsd / usdPerLoan), 0) + toFloat(idleWd, v.asset.decimals);
  const anyWdMissing = markets.some((m) => m.withdrawableUsd === null);
  sources.withdrawableUsd = 'computed: sum(min(position, market liquidity)) + idle';
  let withdrawableUsd: number | null = anyWdMissing ? null : usd(wdTokens);
  if (anyWdMissing) errors.withdrawableUsd = 'at least one market liquidity could not be sourced';

  let events: CuratorEvent[] = [];
  let last: number | null = null;
  let lastConfig: number | null = null;
  let lastAlloc: number | null = null;
  let totalEvents = 0;
  let window: VaultSnapshot['curatorEventsWindow'] = null;
  if (!opts.skipCuratorEvents) {
    const ce = await fetchCuratorEvents(chainId, v.address, { version: v.version, ...(opts.curatorLookbackBlocks ? { blocks: opts.curatorLookbackBlocks } : {}) });
    if (ce.ok) {
      events = ce.value.events; last = ce.value.lastCuratorActionAt; lastConfig = ce.value.lastConfigActionAt; lastAlloc = ce.value.lastAllocatorActionAt; totalEvents = ce.value.totalEvents;
      window = { fromBlock: ce.value.fromBlock, toBlock: ce.value.toBlock, lookbackSeconds: ce.value.lookbackSeconds };
      sources.lastCuratorActionAt = sources.curatorEvents = `${ce.source} on ${v.address}`;
    } else { errors.curatorEvents = ce.error; errors.lastCuratorActionAt = ce.error; }
  }

  return {
    vault: {
      address: v.address, chainId, version: v.version, name: v.name, symbol: v.symbol, asset: v.asset,
      curatorName: v.curatorName, curatorAddress: v.curatorAddress, totalAssetsUsd: v.totalAssetsUsd, netApy: v.netApy,
    },
    ts: Math.floor(Date.now() / 1000), markets, idleUsd: usd(idleTokens), withdrawableUsd,
    lastCuratorActionAt: last, lastConfigActionAt: lastConfig, lastAllocatorActionAt: lastAlloc, curatorEventsTotal: totalEvents, curatorEvents: events, curatorEventsWindow: window, sources, errors,
  };
}
