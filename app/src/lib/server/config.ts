import 'server-only';
import path from 'node:path';
import { isAddress, getAddress } from 'viem';
import type { PublicConfig } from '@/lib/types';

export const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? '../data');
/** Replay datasets ship in the repo; they never live on the DATA_DIR volume. */
export const REPLAY_DIR = path.resolve(process.cwd(), process.env.REPLAY_DIR ?? '../data/replay');
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const KNOWN_NAMES: Record<string, string> = {
  '0xbeef010f9cb27031ad51e3333f9af9c6b1228183': 'Steakhouse USDC',
  '0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61': 'Gauntlet USDC Prime',
};
const DEFAULT_APPROVED = ['0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183', '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61'];

const addr = (...keys: string[]): string | null => {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v && isAddress(v)) return getAddress(v);
  }
  return null;
};

export const houseAccount = () => addr('HOUSE_ACCOUNT') as `0x${string}` | null;

export function publicConfig(): PublicConfig {
  const list = (process.env.APPROVED_VAULTS ?? '').split(',').map((s) => s.trim()).filter((s) => isAddress(s));
  const approved = (list.length ? list : DEFAULT_APPROVED).map((a) => getAddress(a));
  return {
    chainId: 8453,
    factory: addr('FACTORY', 'FACTORY_ADDRESS', 'LIFEBOAT_FACTORY'),
    houseAccount: houseAccount(),
    keeper: addr('KEEPER', 'KEEPER_ADDR', 'KEEPER_ADDRESS'),
    usdc: USDC_BASE,
    approvedVaults: approved.map((a) => ({ address: a, name: KNOWN_NAMES[a.toLowerCase()] ?? 'Approved vault' })),
    explorer: 'https://basescan.org',
    repo: 'https://github.com/jenzylove/lifeboat',
  };
}
