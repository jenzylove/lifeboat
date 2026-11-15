/** Server side keeper: signs exit / move / deposit on Lifeboat accounts. Needs KEEPER_PK. Never import from browser code. */
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toHex, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

export const ACCOUNT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function asset() view returns (address)',
  'function keeperPaused() view returns (bool)',
  'function vaults() view returns (address[])',
  'function allowedVault(address) view returns (bool)',
  'function positionOf(address vault) view returns (uint256 shares, uint256 assets, uint256 withdrawableAssets)',
  'function deposit(address vault, uint256 amount) returns (uint256)',
  'function exit(address vault, bytes32 decisionHash, string reason) returns (uint256, uint256)',
  'function move(address from, address to, bytes32 decisionHash, string reason) returns (uint256, uint256)',
  'function withdraw(uint256 amount)',
  'function ownerRedeemAll(address vault) returns (uint256)',
  'function setVault(address vault, bool allowed)',
  'function setKeeperPaused(bool paused)',
  'event Deposited(address indexed vault, uint256 assets, uint256 shares, address indexed by)',
  'event Exited(address indexed vault, uint256 assets, uint256 shares, address indexed by, bytes32 decisionHash, string reason)',
]);
export const FACTORY_ABI = parseAbi([
  'function create(address[] vaults) returns (address)',
  'function accountOf(address owner) view returns (address)',
  'function predict(address owner) view returns (address)',
  'function keeper() view returns (address)',
  'event AccountCreated(address indexed owner, address indexed account, address[] vaults)',
]);
export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);
export const VAULT_ABI = parseAbi(['function name() view returns (string)', 'function asset() view returns (address)']);

export const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_RPC = process.env.BASE_RPC_URL ?? 'https://base-rpc.publicnode.com';

export const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

function keeperWallet() {
  const pk = process.env.KEEPER_PK as `0x${string}` | undefined;
  if (!pk) throw new Error('KEEPER_PK not set');
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain: base, transport: http(BASE_RPC) });
}

export interface Position {
  vault: Address;
  name: string;
  allowed: boolean;
  shares: string;
  assets: number; // USDC
  withdrawable: number; // USDC
}

export interface AccountStatus {
  account: Address;
  owner: Address;
  keeper: Address;
  paused: boolean;
  idle: number; // USDC
  positions: Position[];
  total: number;
  readAt: number;
}

export async function accountStatus(account: Address): Promise<AccountStatus> {
  const [owner, keeper, paused, vaults, idleRaw] = await Promise.all([
    publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'owner' }),
    publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'keeper' }),
    publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'keeperPaused' }),
    publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'vaults' }),
    publicClient.readContract({ address: USDC_BASE, abi: ERC20_ABI, functionName: 'balanceOf', args: [account] }),
  ]);
  const positions = await Promise.all(
    vaults.map(async (v): Promise<Position> => {
      const [pos, name, allowed] = await Promise.all([
        publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'positionOf', args: [v] }),
        publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'name' }),
        publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'allowedVault', args: [v] }),
      ]);
      return { vault: v, name, allowed, shares: pos[0].toString(), assets: Number(pos[1]) / 1e6, withdrawable: Number(pos[2]) / 1e6 };
    }),
  );
  const idle = Number(idleRaw) / 1e6;
  return { account, owner, keeper, paused, idle, positions, total: idle + positions.reduce((s, p) => s + p.assets, 0), readAt: Math.floor(Date.now() / 1000) };
}

export function decisionHashOf(recordHash: string): `0x${string}` {
  return /^0x[0-9a-f]{64}$/i.test(recordHash) ? (recordHash as `0x${string}`) : keccak256(toHex(recordHash));
}

export interface TxResult {
  hash: Hash;
  status: 'success' | 'reverted';
  block: bigint;
  explorer: string;
}

/**
 * One signer at a time across processes (the web drill and the watcher share the keeper key).
 * A directory lock under DATA_DIR; a lock older than 180 s is treated as stale.
 */
export async function withKeeperLock<T>(fn: () => Promise<T>, waitMs = 120_000): Promise<T> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(process.env.DATA_DIR ?? path.resolve(process.cwd(), '../data'), 'locks', 'keeper');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > 180_000) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* raced with another remover */
      }
      if (Date.now() - t0 > waitMs) throw new Error('keeper busy, try again shortly');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function send(fn: 'move' | 'exit' | 'deposit', account: Address, args: readonly unknown[]): Promise<TxResult> {
  return withKeeperLock(() => sendUnlocked(fn, account, args));
}

async function sendUnlocked(fn: 'move' | 'exit' | 'deposit', account: Address, args: readonly unknown[]): Promise<TxResult> {
  const w = keeperWallet();
  const { request } = await publicClient.simulateContract({ account: w.account, address: account, abi: ACCOUNT_ABI, functionName: fn, args: args as never });
  const hash = await w.writeContract(request);
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return { hash, status: r.status, block: r.blockNumber, explorer: `https://basescan.org/tx/${hash}` };
}

export const keeperMove = (account: Address, from: Address, to: Address, recordHash: string, reason: string) =>
  send('move', account, [from, to, decisionHashOf(recordHash), reason.slice(0, 200)]);
export const keeperExit = (account: Address, vault: Address, recordHash: string, reason: string) =>
  send('exit', account, [vault, decisionHashOf(recordHash), reason.slice(0, 200)]);
export const keeperDeposit = (account: Address, vault: Address, amount: bigint) => send('deposit', account, [vault, amount]);

/**
 * Fire drill on an account: move everything from the vault it is in now to the other approved vault.
 * Real mainnet transaction. Caller is responsible for rate limiting.
 */
export async function runDrill(account: Address, recordHash: string): Promise<{ before: AccountStatus; tx: TxResult; after: AccountStatus; from: Address; to: Address }> {
  const before = await accountStatus(account);
  const holding = [...before.positions].sort((a, b) => b.assets - a.assets)[0];
  if (!holding || holding.assets <= 0) throw new Error('account holds nothing in a vault');
  const to = before.positions.find(p => p.vault !== holding.vault && p.allowed);
  if (!to) throw new Error('no second approved vault to park in');
  const tx = await keeperMove(account, holding.vault, to.vault, recordHash, `Fire drill: exit ${holding.name}, park in ${to.name}`);
  const after = await accountStatus(account);
  return { before, tx, after, from: holding.vault, to: to.vault };
}
