import { CHAIN_NAMES, type ChainId, type Result, ok, err } from './types.js';

export interface MarketPrice {
  /** collateral price in LOAN token units (loan tokens per 1 whole collateral token) */
  price: number;
  source: 'defillama' | 'paraswap';
  /** unix seconds the price refers to */
  timestamp: number;
  /** 0..1 from DefiLlama (min of the two legs). null when the source does not provide one (paraswap quote). */
  confidence: number | null;
  detail: string;
}

interface Llama { coins: Record<string, { price: number; timestamp: number; confidence?: number; symbol?: string }> }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

/**
 * Primary: DefiLlama USD prices for collateral and loan token, price = collateralUsd / loanUsd.
 * Dividing by the loan token's USD price means a loan depeg (e.g. USDC) is reflected, not assumed away.
 */
export async function llamaPrice(chainId: ChainId, collateral: string, loan: string): Promise<Result<MarketPrice>> {
  const src = 'defillama';
  try {
    const chain = CHAIN_NAMES[chainId];
    const kc = `${chain}:${collateral}`;
    const kl = `${chain}:${loan}`;
    const data = await fetchJson<Llama>(`https://coins.llama.fi/prices/current/${kc},${kl}`);
    // llama keys keep the casing we sent; match case-insensitively to be safe
    const find = (k: string) => Object.entries(data.coins).find(([key]) => key.toLowerCase() === k.toLowerCase())?.[1];
    const c = find(kc);
    const l = find(kl);
    if (!c) return err(`no DefiLlama price for collateral ${kc}`, src);
    if (!l) return err(`no DefiLlama price for loan token ${kl}`, src);
    if (!(c.price > 0) || !(l.price > 0)) return err('non-positive DefiLlama price', src);
    return ok({
      price: c.price / l.price, source: 'defillama', timestamp: Math.min(c.timestamp, l.timestamp),
      confidence: Math.min(c.confidence ?? 0, l.confidence ?? 0),
      detail: `collateral $${c.price} / loan $${l.price}`,
    }, src);
  } catch (e) {
    return err(e, src);
  }
}

/**
 * Fallback: Paraswap (Velora) aggregator SELL quote of the collateral for the loan token, no API key required.
 * Sells ~`sizeLoanTokens` worth (sized with `hintPrice`) so it reflects executable price, including a little impact.
 * (Odos was tried first but api.odos.xyz currently answers Cloudflare error 1033.)
 */
export async function paraswapPrice(
  chainId: ChainId,
  collateral: { address: string; decimals: number },
  loan: { address: string; decimals: number },
  hintPrice: number,
  sizeLoanTokens = 1000,
): Promise<Result<MarketPrice>> {
  const src = 'paraswap';
  try {
    if (!(hintPrice > 0)) return err('paraswap needs a positive hint price to size the quote', src);
    const collAmount = BigInt(Math.max(1, Math.floor((sizeLoanTokens / hintPrice) * 10 ** collateral.decimals)));
    const u = new URL('https://api.paraswap.io/prices');
    u.search = new URLSearchParams({
      srcToken: collateral.address, srcDecimals: String(collateral.decimals),
      destToken: loan.address, destDecimals: String(loan.decimals),
      amount: collAmount.toString(), side: 'SELL', network: String(chainId), version: '6.2',
    }).toString();
    const j = await fetchJson<{ priceRoute?: { destAmount: string; srcAmount: string }; error?: string }>(u.toString());
    if (!j.priceRoute) return err(j.error ?? 'no route', src);
    const out = Number(BigInt(j.priceRoute.destAmount)) / 10 ** loan.decimals;
    const inn = Number(BigInt(j.priceRoute.srcAmount)) / 10 ** collateral.decimals;
    if (!(out > 0 && inn > 0)) return err('empty quote', src);
    return ok({
      price: out / inn, source: 'paraswap', timestamp: Math.floor(Date.now() / 1000), confidence: null,
      detail: `SELL ${inn} collateral -> ${out} loan`,
    }, src);
  } catch (e) {
    return err(e, src);
  }
}

/** Primary DefiLlama, fallback Paraswap quote. Returns an explicit error (listing both causes) if both fail. */
export async function getMarketPrice(
  chainId: ChainId,
  collateral: { address: string; decimals: number },
  loan: { address: string; decimals: number },
  opts: { hintPrice?: number } = {},
): Promise<Result<MarketPrice>> {
  const a = await llamaPrice(chainId, collateral.address, loan.address);
  if (a.ok) return a;
  if (opts.hintPrice) {
    const b = await paraswapPrice(chainId, collateral, loan, opts.hintPrice);
    if (b.ok) return b;
    return err(`defillama: ${a.error}; paraswap: ${b.error}`, 'defillama+paraswap');
  }
  return err(`defillama: ${a.error}; paraswap skipped (no hint price)`, 'defillama');
}

/** USD price of a single token from DefiLlama, null when unavailable. */
export async function llamaUsdPrice(chainId: ChainId, token: string): Promise<number | null> {
  try {
    const k = `${CHAIN_NAMES[chainId]}:${token}`;
    const d = await fetchJson<Llama>(`https://coins.llama.fi/prices/current/${k}`);
    const p = Object.values(d.coins)[0]?.price;
    return p && p > 0 ? p : null;
  } catch {
    return null;
  }
}
