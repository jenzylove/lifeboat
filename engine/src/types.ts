export type ChainId = 8453 | 1;

/** Explicit success/error state. Sources never return guesses. */
export type Result<T> = { ok: true; value: T; source: string } | { ok: false; error: string; source: string };

export const ok = <T>(value: T, source: string): Result<T> => ({ ok: true, value, source });
export const err = (error: unknown, source: string): { ok: false; error: string; source: string } => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
  source,
});

export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
}

export const CHAIN_NAMES: Record<ChainId, 'base' | 'ethereum'> = { 8453: 'base', 1: 'ethereum' };

export const MORPHO_BLUE: Record<ChainId, `0x${string}`> = {
  8453: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  1: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
};
