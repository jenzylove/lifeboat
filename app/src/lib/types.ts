// Client safe types shared by API routes and pages.
export type MarketStatus = 'calm' | 'watch' | 'clock' | 'unknown';

export interface BoardMarket {
  marketId: string;
  collateral: string;
  oraclePrice: number | null;
  marketPrice: number | null;
  marketPriceSource: string | null;
  gapPct: number | null;
  oracleUnchangedFor: string | null;
  fixedByDesign: boolean | null;
  utilization: number | null;
  allocationUsd: number | null;
  withdrawableUsd: number | null;
  liquidityUsd: number | null;
  lltv: number | null;
  status: MarketStatus;
  sources: Record<string, string>;
  errors: Record<string, string>;
}

export interface BoardVault {
  address: string;
  chainId: number;
  version: string;
  name: string;
  curator: string | null;
  curatorAddress: string | null;
  tvlUsd: number | null;
  apy: number | null;
  withdrawableUsd: number | null;
  idleUsd: number | null;
  lastCuratorActionAt: number | null;
  lastConfigActionAt: number | null;
  lastAllocatorActionAt: number | null;
  markets: BoardMarket[];
  openClocks: number;
  error: string | null;
  sources: Record<string, string>;
  errors: Record<string, string>;
}

export interface Board {
  chainId: number;
  readAt: number;
  vaults: BoardVault[];
  totals: { vaults: number; markets: number; clocks: number; watch: number };
  stale: boolean;
  error: string | null;
}

export interface CuratorEventView {
  kind: string;
  blockNumber: number;
  txHash: string;
  timestamp: number | null;
  caller: string | null;
  marketId: string | null;
  explorer: string;
}

export interface VaultView extends BoardVault {
  readAt: number;
  curatorEvents: CuratorEventView[];
  curatorEventsTotal: number;
  curatorEventsWindow: { fromBlock: number; toBlock: number; lookbackSeconds: number } | null;
}

export interface PublicConfig {
  chainId: 8453;
  factory: string | null;
  houseAccount: string | null;
  keeper: string | null;
  usdc: string;
  approvedVaults: { address: string; name: string }[];
  explorer: string;
  repo: string;
}

export interface DecisionSummary {
  file: string;
  hash: string;
  at: number;
  mode: string;
  vault: string;
  marketId: string;
  action: string;
  decidedBy: string;
  rule: string | null;
  targetVault: string | null;
  model: { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null; ms: number } | null;
  modelError: string | null;
  summary: string | null;
  notice: string | null;
  noticeModel: string | null;
  tx: { hash: string | null; explorer: string | null; ok: boolean | null; error: string | null } | null;
  evidenceCount: number;
}
