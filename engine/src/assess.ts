/**
 * "Ask Lifeboat now": run the real decision on any vault's live data, on demand.
 * Same evidence pack, same Dolphin call, same clamp, same SERV explanation. Advisory only: no transaction is sent.
 */
import { snapshotVault, type VaultSnapshot, type MarketSnapshot } from './snapshot.js';
import { curatorActionsFor, redact, latestForumTopics } from './watcher.js';
import { decide, type DecisionRecord } from './decide/decide.js';
import { serv } from './decide/llm.js';
import type { ClockState, MarketRead } from './decide/policy.js';
import type { CandidateVault } from './decide/evidence.js';
import type { ChainId } from './types.js';

export interface Assessment {
  record: DecisionRecord;
  vault: { address: string; name: string; curator: string | null; chainId: ChainId };
  market: { id: string; collateral: string; gapPct: number | null; utilization: number | null; allocationUsd: number | null };
  explanation: { text: string; provider: string; model: string } | null;
}

/** Riskiest market the vault actually lends into: biggest positive gap first, then most borrowed. */
export function riskiest(markets: MarketSnapshot[]): MarketSnapshot | null {
  const live = markets.filter(m => (m.allocationUsd ?? 0) > 0);
  if (!live.length) return null;
  return [...live].sort((a, b) => (b.gapPct ?? -1e9) - (a.gapPct ?? -1e9) || (b.utilization ?? 0) - (a.utilization ?? 0))[0]!;
}

export async function assessVault(chainId: ChainId, vaultAddress: string, candidates: CandidateVault[], snap?: VaultSnapshot): Promise<Assessment> {
  const s = snap ?? (await snapshotVault(chainId, vaultAddress, { curatorLookbackBlocks: chainId === 8453 ? 43_200 : 7_200 }));
  const m = riskiest(s.markets);
  if (!m) throw new Error('this vault has no money lent into any market right now');
  const now = Math.floor(Date.now() / 1000);
  const read: MarketRead = { ts: now, marketId: m.marketId, collateralSymbol: m.collateral.symbol, oraclePrice: m.oraclePrice, marketPrice: m.marketPrice, utilization: m.utilization, exposureUsd: m.allocationUsd ?? 0 };
  // An on demand check: the clock is opened for this one question so the model is consulted; hard rules still apply.
  const clock: ClockState = { marketId: m.marketId, divergentReads: 1, openedAt: now, kind: 'gap' };
  const curatorUnknown = Boolean(s.errors.curatorEvents);
  const others = s.markets
    .filter(x => x.marketId !== m.marketId && (x.allocationUsd ?? 0) > 0)
    .slice(0, 8)
    .map(x => ({ ts: now, text: `Other market in this vault: ${x.collateral.symbol} collateral, oracle ${x.oraclePrice?.toFixed(4) ?? 'unknown'} vs market ${x.marketPrice?.toFixed(4) ?? 'unknown'} (gap ${x.gapPct == null ? 'unknown' : x.gapPct.toFixed(2) + '%'}), ${x.utilization == null ? 'utilization unknown' : Math.round(x.utilization * 100) + '% borrowed'}, vault exposure $${Math.round(x.allocationUsd ?? 0)}`, source: 'snapshotVault onchain' }));
  const record = await decide(
    {
      user: { vault: s.vault.address, vaultName: s.vault.name, curator: s.vault.curatorName ?? 'unknown', positionUsd: 1000, withdrawableUsd: Math.min(1000, s.withdrawableUsd ?? 0) },
      marketId: m.marketId,
      collateral: m.collateral.symbol,
      clockOpenedAt: now,
      now,
      reads: [read],
      curatorActions: curatorUnknown ? [] : await curatorActionsFor(s, m.marketId),
      curatorUnknown,
      supplyChanges: [],
      posts: await latestForumTopics(5),
      candidates,
      related: [
        { ts: now, text: 'ON DEMAND CHECK: a person asked Lifeboat to assess this vault right now. No alarm has fired; the market shown is simply the riskiest one this vault lends into. Decide what you would do for a $1,000 depositor today: STAY if nothing justifies leaving.', source: 'lifeboat' },
        ...(m.fixedByDesign ? [{ ts: now, text: 'This market oracle price has not changed in 7 days of samples: likely a fixed rate feed by design, so a small steady gap can be normal.', source: 'oracle price() history onchain' }] : []),
        ...others,
      ],
      readSource: `live snapshot: oracle price() onchain, market price ${m.marketPriceMeta?.source ?? 'unavailable'}, Morpho Blue market() onchain`,
    },
    clock,
    'ask',
  );
  let explanation: Assessment['explanation'] = null;
  if (process.env.SERV_API_KEY) {
    const d = record.decision;
    const headline = d.action === 'LEAVE' ? `Lifeboat would move a depositor out of ${s.vault.name} right now.` : d.action === 'WAIT' ? `Lifeboat would keep watching ${s.vault.name} closely.` : `Lifeboat would keep a depositor in ${s.vault.name} right now.`;
    const reasons = [...(d.rule ? [`Safety rule: ${d.rule.replace(/_/g, ' ')}`] : []), ...(d.model?.reasons ?? []).map(r => r.claim)];
    try {
      const r = await serv(
        [
          { role: 'system', content: 'You explain a decision to a person who lends USDC. Two or three short sentences, plain words, no jargon, no dashes. Use only the reasons given. An oracle price is the price the lending market trusts; a market price is what the token really trades at. Do not mix them up. Do not restate the decision, do not add facts, do not give advice.' },
          { role: 'user', content: [`Decision: ${headline}`, 'Reasons:', ...reasons.map(x => `- ${x}`)].join('\n') },
        ],
        { maxTokens: 2000 },
      );
      explanation = { text: `${headline} ${r.text.trim()}`, provider: r.provider, model: r.model };
    } catch (e) {
      explanation = null;
      void redact(e);
    }
  }
  return {
    record,
    vault: { address: s.vault.address, name: s.vault.name, curator: s.vault.curatorName, chainId },
    market: { id: m.marketId, collateral: m.collateral.symbol, gapPct: m.gapPct, utilization: m.utilization, allocationUsd: m.allocationUsd },
    explanation,
  };
}
