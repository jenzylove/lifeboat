import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';
import { base, mainnet } from 'viem/chains';
import { MORPHO_BLUE, type ChainId } from './types.js';
import { marketLiquidity, oraclePriceToFloat, sharesToAssetsDown, utilization } from './math.js';

export const RPC_URLS: Record<ChainId, string> = {
  8453: process.env.BASE_RPC_URL ?? 'https://base-rpc.publicnode.com',
  1: process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
};

/**
 * Historical state (eth_call at old blocks) and old logs need an archive node. publicnode serves Base archive for free but
 * refuses Ethereum archive without a token, so Ethereum history defaults to the free MEV Blocker RPC. Override with *_ARCHIVE_RPC_URL.
 */
export const ARCHIVE_RPC_URLS: Record<ChainId, string> = {
  8453: process.env.BASE_ARCHIVE_RPC_URL ?? RPC_URLS[8453],
  1: process.env.ETH_ARCHIVE_RPC_URL ?? 'https://rpc.mevblocker.io',
};

/** Seconds per block, used to convert wall-clock ages to block heights. */
export const BLOCK_TIME_S: Record<ChainId, number> = { 8453: 2, 1: 12 };

const clients: Record<string, PublicClient> = {};
/** archive=true returns a client on the archive endpoint (history reads, large getLogs ranges). */
export function getClient(chainId: ChainId, archive = false): PublicClient {
  const url = archive ? ARCHIVE_RPC_URLS[chainId] : RPC_URLS[chainId];
  clients[url] ??= createPublicClient({
    chain: chainId === 8453 ? base : mainnet,
    transport: http(url, { retryCount: 3, retryDelay: 400, timeout: 30_000 }),
  }) as PublicClient;
  return clients[url]!;
}

export const oracleAbi = parseAbi(['function price() view returns (uint256)']);
export const morphoAbi = parseAbi([
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
]);

/** Raw IOracle.price() at `blockNumber` (latest when omitted). */
export async function readOraclePriceRaw(chainId: ChainId, oracle: string, blockNumber?: bigint): Promise<bigint> {
  return getClient(chainId, blockNumber !== undefined).readContract({
    address: oracle as `0x${string}`, abi: oracleAbi, functionName: 'price', ...(blockNumber ? { blockNumber } : {}),
  });
}

/**
 * Oracle price of one whole collateral token in whole loan tokens (see math.oraclePriceToFloat for the scaling).
 * Throws if the oracle call reverts; callers wrap in Result.
 */
export async function readOraclePrice(
  chainId: ChainId, oracle: string, loanDecimals: number, collateralDecimals: number, blockNumber?: bigint,
): Promise<{ raw: bigint; price: number }> {
  const raw = await readOraclePriceRaw(chainId, oracle, blockNumber);
  return { raw, price: oraclePriceToFloat(raw, loanDecimals, collateralDecimals) };
}

export interface MarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  utilization: number;
  /** supply - borrow, loan base units */
  liquidity: bigint;
}

/** Morpho Blue market(id). Note: totals are as of lastUpdate; unaccrued interest is not included. */
export async function readMarket(chainId: ChainId, marketId: string): Promise<MarketState> {
  const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate] =
    await getClient(chainId).readContract({
      address: MORPHO_BLUE[chainId], abi: morphoAbi, functionName: 'market', args: [marketId as `0x${string}`],
    });
  return {
    totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate,
    utilization: utilization(totalSupplyAssets, totalBorrowAssets),
    liquidity: marketLiquidity(totalSupplyAssets, totalBorrowAssets),
  };
}

/** A vault's position in a market, in loan base units (shares converted with Morpho's rounding-down math). */
export async function readVaultPosition(chainId: ChainId, marketId: string, vault: string, m?: MarketState): Promise<bigint> {
  const [supplyShares] = await getClient(chainId).readContract({
    address: MORPHO_BLUE[chainId], abi: morphoAbi, functionName: 'position',
    args: [marketId as `0x${string}`, vault as `0x${string}`],
  });
  const ms = m ?? (await readMarket(chainId, marketId));
  return sharesToAssetsDown(supplyShares, ms.totalSupplyAssets, ms.totalSupplyShares);
}
