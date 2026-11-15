// Mainnet launch on Base: deploy factory, create the house boat, fund it, deposit.
// Reads KEEPER_PK and HOUSE_OWNER_PK from ../.env. Prints addresses and tx links only.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const RPC = process.env.BASE_RPC_URL ?? 'https://base-rpc.publicnode.com';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const STEAKHOUSE = '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183';
const GAUNTLET = '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61';
const HOUSE_USDC = BigInt(process.env.HOUSE_USDC ?? '2000000'); // 2 USDC
const HOUSE_ETH = parseEther(process.env.HOUSE_ETH ?? '0.0003');

const pub = createPublicClient({ chain: base, transport: http(RPC) });
const keeper = createWalletClient({ account: privateKeyToAccount(env.KEEPER_PK), chain: base, transport: http(RPC) });
const owner = createWalletClient({ account: privateKeyToAccount(env.HOUSE_OWNER_PK), chain: base, transport: http(RPC) });
const ERC20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const FACTORY = parseAbi(['function create(address[] vaults) returns (address)', 'function accountOf(address) view returns (address)']);
const ACCOUNT = parseAbi(['function deposit(address vault, uint256 amount) returns (uint256)']);
const link = h => `https://basescan.org/tx/${h}`;
const wait = async h => { const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== 'success') throw new Error('reverted ' + h); return r; };
const out = {};

let factory = env.FACTORY;
if (!factory) {
  const cmd = `forge create src/LifeboatFactory.sol:LifeboatFactory --rpc-url ${RPC} --private-key ${env.KEEPER_PK} --broadcast --json --constructor-args ${keeper.account.address} ${USDC}`;
  let res;
  try {
    res = JSON.parse(execSync(cmd, { cwd: new URL('../contracts', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    // Never echo the command: it carries the private key.
    const msg = String(e.stderr ?? e.message ?? e).split(env.KEEPER_PK).join('[redacted]').split(/\r?\n/).filter(l => !l.includes('--private-key')).slice(0, 5).join(' | ');
    console.error('forge create failed:', msg);
    process.exit(1);
  }
  factory = res.deployedTo;
  const r = await pub.getTransactionReceipt({ hash: res.transactionHash });
  out.factory = factory; out.factoryTx = link(res.transactionHash); out.factoryBlock = Number(r.blockNumber);
  fs.appendFileSync(new URL('../.env', import.meta.url), `FACTORY=${factory}\nFACTORY_BLOCK=${r.blockNumber}\n`);
}
console.log('factory', factory);

// gas for the house owner
if ((await pub.getBalance({ address: owner.account.address })) < HOUSE_ETH / 2n) {
  const h = await keeper.sendTransaction({ to: owner.account.address, value: HOUSE_ETH }); await wait(h); out.gasTx = link(h);
}
// create house account
let acct = await pub.readContract({ address: factory, abi: FACTORY, functionName: 'accountOf', args: [owner.account.address] });
if (acct === '0x0000000000000000000000000000000000000000') {
  const h = await owner.writeContract({ address: factory, abi: FACTORY, functionName: 'create', args: [[STEAKHOUSE, GAUNTLET]] }); await wait(h); out.createTx = link(h);
  acct = await pub.readContract({ address: factory, abi: FACTORY, functionName: 'accountOf', args: [owner.account.address] });
  fs.appendFileSync(new URL('../.env', import.meta.url), `HOUSE_ACCOUNT=${acct}\n`);
}
console.log('house account', acct);
// fund with USDC from keeper, then owner deposits into Steakhouse
if ((await pub.readContract({ address: USDC, abi: ERC20, functionName: 'balanceOf', args: [acct] })) < HOUSE_USDC) {
  const h = await keeper.writeContract({ address: USDC, abi: ERC20, functionName: 'transfer', args: [acct, HOUSE_USDC] }); await wait(h); out.fundTx = link(h);
}
const h = await owner.writeContract({ address: acct, abi: ACCOUNT, functionName: 'deposit', args: [STEAKHOUSE, 2n ** 256n - 1n] }); await wait(h); out.depositTx = link(h);
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('../data/launch.json', import.meta.url), JSON.stringify({ ...out, factory, houseAccount: acct, keeper: keeper.account.address, houseOwner: owner.account.address, at: new Date().toISOString() }, null, 1));
