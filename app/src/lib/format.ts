import type { MarketStatus } from './types';

/** gapPct is in percent. Positive = oracle above market, the direction where lenders are at risk. */
export function marketStatus(gapPct: number | null): MarketStatus {
  if (gapPct === null || !Number.isFinite(gapPct)) return 'unknown';
  if (gapPct >= 5) return 'clock';
  if (Math.abs(gapPct) >= 1) return 'watch';
  return 'calm';
}

export const usd = (n: number | null | undefined, digits = 0): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'unavailable';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) })}`;
};

export const price = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'unavailable';
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

export const pct = (n: number | null | undefined, digits = 2, signed = false): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'unavailable';
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export const ratioPct = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? 'unavailable' : `${(n * 100).toFixed(digits)}%`;

export function ago(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return 'unknown';
  const s = Math.max(0, Math.floor(now - ts));
  if (s < 90) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export const short = (a: string | null | undefined, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : 'unavailable');

export const bucketWords: Record<string, string> = {
  '<1h': 'moved in the last hour',
  '1h-6h': 'still for 1 to 6 hours',
  '6h-24h': 'still for 6 to 24 hours',
  '1d-7d': 'still for 1 to 7 days',
  '>=7d': 'still for 7 days or more',
  unknown: 'history unavailable',
};

export const explorerFor = (chainId: number) => (chainId === 1 ? 'https://etherscan.io' : 'https://basescan.org');

export const utcTime = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 16) + ' UTC';
export const utcDate = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
