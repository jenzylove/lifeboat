/**
 * The sweep: one Dolphin call reads every market Lifeboat is guarding next to every live break,
 * and flags guarded markets at risk by association (same issuer, wrapped or derived token, shared backing).
 * A price feed cannot see this: on Mar 22 2026 the RLP feed showed no gap for an hour after its sister token USR collapsed.
 * Code only accepts flags on markets it actually guards; a flag opens a clock, it never moves money by itself.
 */
import { dolphin, extractJson, type LlmResult } from './llm.js';

export interface GuardedMarket {
  marketId: string;
  collateralSymbol: string;
  collateralName: string;
  collateralAddress: string;
  vaultName: string;
  exposureUsd: number;
}

export interface Break {
  marketId: string;
  collateralSymbol: string;
  collateralName: string;
  collateralAddress: string;
  gapPct: number; // oracle above market, percent
  since: number; // unix seconds
  where: string;
}

export interface Flag {
  marketId: string;
  related_to: string[]; // break collateral symbols
  reason: string;
}

export interface SweepResult {
  flags: Flag[];
  model: Pick<LlmResult, 'model' | 'provider' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'ms'> | null;
  error: string | null;
  raw: string | null;
}

const SYSTEM = `You guard lenders' USDC in lending markets. Some collateral tokens are breaking right now (their real price fell well below the price the lending market uses).
For each guarded market, decide if its collateral is exposed to a break through a relationship a price feed would miss: the same issuer or protocol, a wrapped, staked or tranche version of a breaking token, or the breaking token backing it.
Unrelated tokens that merely share a broad category (two different stablecoins from different issuers) are NOT related.
Return only JSON: {"flags":[{"marketId":"0x...","related_to":["SYMBOL"],"reason":"one sentence"}]} with an empty list when nothing is related.`;

export function buildSweepMessage(guarded: GuardedMarket[], breaks: Break[], now: number): string {
  const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
  return [
    `NOW ${iso(now)}`,
    'BREAKING:',
    ...breaks.map(b => `- ${b.collateralSymbol} "${b.collateralName}" (${b.collateralAddress}) on ${b.where}: oracle ${b.gapPct.toFixed(0)}% above market since ${iso(b.since)}`),
    'GUARDED:',
    ...guarded.map(g => `- market ${g.marketId}: collateral ${g.collateralSymbol} "${g.collateralName}" (${g.collateralAddress}) in vault ${g.vaultName}, exposure $${Math.round(g.exposureUsd)}`),
  ].join('\n');
}

/** Models vary key names; accept the obvious variants, drop anything without a market id and a reason. */
export function normalizeFlags(parsed: unknown): Flag[] {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const list = (o.flags ?? o.related_markets ?? o.relatedMarkets ?? o.markets ?? (Array.isArray(parsed) ? parsed : [])) as Record<string, unknown>[];
  if (!Array.isArray(list)) return [];
  const out: Flag[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const marketId = (f.marketId ?? f.market_id ?? f.market ?? f.id) as unknown;
    const reason = (f.reason ?? f.why ?? f.explanation) as unknown;
    const relKey = Object.keys(f).find(k => /^related/i.test(k) && Array.isArray(f[k]));
    const rel = (relKey ? f[relKey] : f.related_to ?? []) as unknown;
    if (typeof marketId !== 'string' || typeof reason !== 'string') continue;
    out.push({ marketId, reason, related_to: Array.isArray(rel) ? rel.map(String) : [String(rel)] });
  }
  return out;
}

export async function sweep(guarded: GuardedMarket[], breaks: Break[], now: number): Promise<SweepResult> {
  // Markets that are themselves breaking already have a gap clock; only look for the ones a feed would miss.
  const breakingIds = new Set(breaks.map(b => b.marketId.toLowerCase()));
  const candidates = guarded.filter(g => !breakingIds.has(g.marketId.toLowerCase()));
  if (!breaks.length || !candidates.length) return { flags: [], model: null, error: null, raw: null };
  try {
    const msgs = [
      { role: 'system' as const, content: SYSTEM },
      { role: 'user' as const, content: buildSweepMessage(candidates, breaks, now) },
    ];
    let r = await dolphin(msgs, { json: true, maxTokens: 1500 });
    try {
      extractJson(r.text);
    } catch {
      r = await dolphin(msgs, { json: true, maxTokens: 1500 }); // one retry on unparseable output
    }
    const known = new Map(candidates.map(c => [c.marketId.toLowerCase(), c]));
    const flags = normalizeFlags(extractJson(r.text)).filter(f => known.has(f.marketId.toLowerCase()));
    return { flags, model: { model: r.model, provider: r.provider, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, ms: r.ms }, error: null, raw: r.text };
  } catch (e) {
    return { flags: [], model: null, error: e instanceof Error ? e.message : String(e), raw: null };
  }
}
