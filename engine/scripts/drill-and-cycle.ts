// Run one fire drill and one watcher cycle against BASE_RPC_URL (fork or mainnet).
import { runDrill, accountStatus } from '../src/keeper.js';
import { cycle } from '../src/watcher.js';

const acct = process.env.HOUSE_ACCOUNT as `0x${string}`;
console.log('before', JSON.stringify(await accountStatus(acct)));
if (process.argv.includes('--drill')) {
  const d = await runDrill(acct, `drill-${Date.now()}`);
  console.log('drill tx', d.tx.explorer, d.tx.status, 'from', d.from, 'to', d.to);
  console.log('after', JSON.stringify(d.after.positions.map(p => [p.name, p.assets])));
}
if (process.argv.includes('--cycle')) {
  const r = await cycle({ act: false });
  console.log('cycle', JSON.stringify({ accounts: r.accounts, markets: r.markets, openClocks: r.openClocks, decisions: r.decisions.length, errors: r.errors }));
}
