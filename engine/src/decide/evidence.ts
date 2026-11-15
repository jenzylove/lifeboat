/**
 * The evidence pack Dolphin reads. Every item has an id the model must cite.
 * Built from sourced data only; each item carries its source.
 */
import { gap, type CuratorAction, type MarketRead } from './policy.js';

export interface EvidenceItem {
  id: string;
  kind: 'market_read' | 'curator_action' | 'collateral_supply' | 'post' | 'vault_candidate' | 'context';
  ts: number | null;
  text: string;
  source: string;
}

export interface CandidateVault {
  address: string;
  name: string;
  curator: string;
  apy: number | null;
  tvlUsd: number | null;
  openClocks: number;
}

export interface SupplyChange {
  ts: number;
  token: string;
  deltaPct: number;
  detail: string;
  source: string;
}

export interface Post {
  ts: number;
  author: string;
  where: string;
  text: string;
  url: string;
}

export interface PackInput {
  user: { vault: string; vaultName: string; curator: string; positionUsd: number; withdrawableUsd: number };
  marketId: string;
  collateral: string;
  clockOpenedAt: number;
  now: number;
  reads: MarketRead[]; // oldest first
  curatorActions: CuratorAction[];
  supplyChanges: SupplyChange[];
  posts: Post[];
  candidates: CandidateVault[];
  readSource: string;
  /** the curator history could not be read */
  curatorUnknown?: boolean;
  /** live breaks in other markets and what the sweep linked to this one */
  related?: { ts: number; text: string; source: string }[];
}

const iso = (ts: number) => new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
const pct = (x: number | null) => (x == null ? 'unknown' : `${(x * 100).toFixed(1)}%`);

export function buildPack(p: PackInput): { items: EvidenceItem[]; ids: Set<string> } {
  const items: EvidenceItem[] = [];
  let n = 0;
  const add = (kind: EvidenceItem['kind'], ts: number | null, text: string, source: string) => items.push({ id: `E${++n}`, kind, ts, text, source });

  add('context', p.now, `Clock opened ${Math.round((p.now - p.clockOpenedAt) / 60)} min ago on market ${p.marketId} (${p.collateral} collateral). User position in vault ${p.user.vaultName}: $${p.user.positionUsd.toFixed(2)}, withdrawable now $${p.user.withdrawableUsd.toFixed(2)}.`, 'lifeboat');
  for (const r of p.related ?? []) add('context', r.ts, r.text, r.source);
  for (const r of p.reads) {
    add('market_read', r.ts, `${iso(r.ts)} oracle ${r.oraclePrice?.toFixed(4) ?? 'unknown'} vs market ${r.marketPrice?.toFixed(4) ?? 'unknown'} (gap ${pct(gap(r.oraclePrice, r.marketPrice))}), utilization ${pct(r.utilization)}, vault exposure $${r.exposureUsd.toFixed(0)}`, p.readSource);
  }
  if (p.curatorUnknown) add('curator_action', null, 'Curator history unreadable this cycle (RPC error): curator silence is unknown, not confirmed.', 'onchain logs');
  else if (p.curatorActions.length === 0) add('curator_action', null, `No curator or allocator action on this market since the clock opened (${iso(p.clockOpenedAt)}).`, 'onchain logs');
  for (const a of p.curatorActions) add('curator_action', a.ts, `${iso(a.ts)} curator action ${a.type} on ${a.marketId}${a.detail ? `: ${a.detail}` : ''} (tx ${a.tx})`, 'onchain logs');
  for (const s of p.supplyChanges) add('collateral_supply', s.ts, `${iso(s.ts)} ${s.token} supply changed ${(s.deltaPct * 100).toFixed(1)}%: ${s.detail}`, s.source);
  for (const post of p.posts) add('post', post.ts, `${iso(post.ts)} ${post.author} on ${post.where}: "${post.text.slice(0, 600)}"`, post.url);
  for (const c of p.candidates) add('vault_candidate', null, `Candidate vault ${c.address} "${c.name}" curated by ${c.curator}: APY ${c.apy == null ? 'unknown' : (c.apy * 100).toFixed(2) + '%'}, TVL ${c.tvlUsd == null ? 'unknown' : '$' + Math.round(c.tvlUsd).toLocaleString('en-US')}, open clocks ${c.openClocks}`, 'morpho api');
  return { items, ids: new Set(items.map(i => i.id)) };
}

export const SYSTEM_PROMPT = `You are Lifeboat, an agent that protects one person's USDC deposited in a Morpho lending vault.
A market in their vault has an oracle price above the real market price of its collateral. If the collateral really lost value, borrowers can post it at the stale price and drain the lenders' USDC; once the market is fully borrowed, lenders cannot withdraw.
The vault's curator can protect lenders by cutting the market's cap, reallocating away, or removing it. Their silence is the danger signal.

Decide for this person, right now:
- LEAVE: withdraw everything withdrawable and park it in one candidate vault (target_vault must be a candidate address from the evidence).
- WAIT: keep watching for wait_minutes (1 to 15), because the evidence does not yet justify leaving.
- STAY: the divergence is benign (for example a fixed by design rate feed with a shallow, stable market discount and no curator concern) or the curator has already handled it.

If the clock opened because this collateral is related to a token that is breaking elsewhere (same issuer, wrapped or tranche version), treat this market's own calm price feed as possibly blind: weigh how much is still withdrawable now against the chance it is gone in minutes.
Weigh: size and direction of the gap and whether it is widening; utilization and how fast it is rising (time left before lenders are locked); curator actions or silence; collateral supply jumps (unbacked minting); public posts from the curator, the protocol, or the collateral issuer. Leaving costs little (some yield, gas); staying through a real depeg can cost the deposit.
Every reason must cite evidence ids like "E3". Do not invent facts.
Return only JSON: {"action":"STAY|WAIT|LEAVE","wait_minutes":number|null,"target_vault":"0x..."|null,"confidence":0..1,"reasons":[{"claim":"...","evidence_ids":["E1"]}],"summary":"one plain sentence for the user"}`;

export function packToUserMessage(items: EvidenceItem[]): string {
  return 'EVIDENCE\n' + items.map(i => `[${i.id}] (${i.kind}) ${i.text}`).join('\n');
}
