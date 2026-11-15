// Usage: npx tsx scripts/snapshot.ts <vaultAddress> [chainId=8453] [--no-events] [--blocks=N]
import { snapshotVault } from '../src/snapshot.js';
import type { ChainId } from '../src/types.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const [vault, chain = '8453'] = args;
if (!vault) {
  console.error('usage: tsx scripts/snapshot.ts <vaultAddress> [chainId=8453|1] [--no-events] [--blocks=N]');
  process.exit(1);
}
const blocks = flags.find((f) => f.startsWith('--blocks='))?.split('=')[1];
const snap = await snapshotVault(Number(chain) as ChainId, vault, {
  skipCuratorEvents: flags.includes('--no-events'),
  ...(blocks ? { curatorLookbackBlocks: Number(blocks) } : {}),
});
console.log(JSON.stringify(snap, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
