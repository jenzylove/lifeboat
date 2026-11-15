// Plumbing check only: a hand made pack shaped like the Mar 22 timeline (not product data).
import { decide } from '../src/decide/decide.js';

const t0 = 1774180800; // 2026-03-22T12:00Z, illustrative
const reads = [0, 10, 20, 30, 40].map((m, i) => ({ ts: t0 + m * 60, marketId: 'mX', collateralSymbol: 'wstUSR', oraclePrice: 1.13, marketPrice: [1.05, 0.9, 0.8, 0.7, 0.63][i]!, utilization: [0.88, 0.9, 0.93, 0.94, 0.945][i]!, exposureUsd: 120000 }));
const rec = await decide(
  {
    user: { vault: '0xVAULT', vaultName: 'Test vault', curator: 'Curator', positionUsd: 1, withdrawableUsd: 1 },
    marketId: 'mX',
    collateral: 'wstUSR',
    clockOpenedAt: t0 + 10 * 60,
    now: t0 + 25 * 60,
    reads,
    curatorActions: [],
    supplyChanges: [{ ts: t0 - 3600, token: 'USR', deltaPct: 0.8, detail: 'supply jumped from ~100M to ~180M in two mints', source: 'fixture' }],
    posts: [],
    candidates: [{ address: '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183', name: 'Steakhouse USDC', curator: 'Steakhouse', apy: 0.05, tvlUsd: 1e8, openClocks: 0 }],
    readSource: 'fixture',
  },
  { marketId: 'mX', divergentReads: 4, openedAt: t0 + 10 * 60 },
  'replay',
  { withNotice: true },
);
console.log(JSON.stringify({ decision: rec.decision, model: { ...rec.model, raw: rec.model?.raw.slice(0, 400) }, notice: rec.notice, hash: rec.hash }, null, 1));
