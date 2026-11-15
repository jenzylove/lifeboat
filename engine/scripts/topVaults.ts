// Usage: npx tsx scripts/topVaults.ts [chainId=8453] [asset=USDC] [n=15]
import { getVault, listVaults } from '../src/morphoApi.js';
import type { ChainId } from '../src/types.js';

const chainId = Number(process.argv[2] ?? 8453) as ChainId;
const asset = process.argv[3] ?? 'USDC';
const n = Number(process.argv[4] ?? 15);

const vaults = (await listVaults(chainId, { asset, limit: 50 })).slice(0, n);
console.log(`Top ${n} ${asset} vaults on chain ${chainId} by TVL (Morpho API, v1+v2)\n`);
console.log('#  ver  TVL(USD)        netAPY  markets  curator              name  address');
let i = 1;
for (const v of vaults) {
  const d = await getVault(chainId, v.address);
  const live = d?.allocations.filter((a) => a.supplyAssets > 0n && !a.isIdle).length ?? 0;
  const all = d?.allocations.filter((a) => !a.isIdle).length ?? 0;
  console.log(
    `${String(i++).padStart(2)} ${v.version}  ${(v.totalAssetsUsd ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(14)}  ` +
      `${v.netApy === null ? '   n/a' : (v.netApy * 100).toFixed(2).padStart(5) + '%'}  ${String(live).padStart(3)}/${String(all).padEnd(3)}  ` +
      `${(v.curatorName ?? '?').padEnd(20)} ${v.name}  ${v.address}`,
  );
}
console.log('\nmarkets = markets with supply > 0 / markets configured in the vault (excluding idle)');
