/**
 * x402 "exact" payments in USDC on Base, settled by Lifeboat itself (no third party facilitator).
 * The payer signs an EIP-3009 transferWithAuthorization; they need no ETH. The keeper verifies the
 * signature and terms, submits the transfer onchain, and only then serves the paid result.
 */
import { createWalletClient, http, parseAbi, verifyTypedData, parseSignature, getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { publicClient, withKeeperLock, USDC_BASE, BASE_RPC } from './keeper.js';

export const X402_PRICE_UNITS = BigInt(process.env.X402_PRICE_UNITS ?? '10000'); // 0.01 USDC
export const X402_NETWORK = 'base';

const USDC_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const DOMAIN = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC_BASE } as const;
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export function payTo(): Address {
  const a = process.env.X402_PAY_TO ?? process.env.KEEPER_ADDR;
  if (!a) throw new Error('x402 payTo not configured');
  return getAddress(a);
}

/** The 402 body a client receives when it calls without paying. */
export function paymentRequirements(resource: string, description: string) {
  return {
    x402Version: 1,
    error: 'X-PAYMENT header is required',
    accepts: [
      {
        scheme: 'exact',
        network: X402_NETWORK,
        maxAmountRequired: X402_PRICE_UNITS.toString(),
        resource,
        description,
        mimeType: 'application/json',
        payTo: payTo(),
        maxTimeoutSeconds: 120,
        asset: USDC_BASE,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
  };
}

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface Settled {
  payer: Address;
  amount: string;
  transaction: Hex;
  explorer: string;
  network: 'base';
}

/** Verify an X-PAYMENT header against our terms, then settle it onchain. Throws with a plain reason on any problem. */
export async function verifyAndSettle(header: string): Promise<Settled> {
  let p: { x402Version?: number; scheme?: string; network?: string; payload?: { signature?: Hex; authorization?: Authorization } };
  try {
    p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new Error('X-PAYMENT is not base64 JSON');
  }
  if (p.scheme !== 'exact' || p.network !== X402_NETWORK) throw new Error('only the exact scheme on base is accepted');
  const a = p.payload?.authorization;
  const sig = p.payload?.signature;
  if (!a || !sig) throw new Error('payment payload is missing the authorization or signature');
  const to = getAddress(a.to);
  if (to !== payTo()) throw new Error('payment is addressed to the wrong account');
  const value = BigInt(a.value);
  if (value < X402_PRICE_UNITS) throw new Error(`payment is below the price of ${X402_PRICE_UNITS} USDC units`);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(a.validAfter) > now || BigInt(a.validBefore) < now + 10n) throw new Error('payment authorization is not valid right now');
  const from = getAddress(a.from);
  const message = { from, to, value, validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce };
  const ok = await verifyTypedData({ address: from, domain: DOMAIN, types: TYPES, primaryType: 'TransferWithAuthorization', message, signature: sig });
  if (!ok) throw new Error('payment signature does not match the payer');
  const used = await publicClient.readContract({ address: USDC_BASE, abi: USDC_ABI, functionName: 'authorizationState', args: [from, a.nonce] });
  if (used) throw new Error('this payment authorization was already used');
  const bal = await publicClient.readContract({ address: USDC_BASE, abi: USDC_ABI, functionName: 'balanceOf', args: [from] });
  if (bal < value) throw new Error('payer does not hold enough USDC');

  const pk = process.env.KEEPER_PK as Hex | undefined;
  if (!pk) throw new Error('settlement signer not configured');
  const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain: base, transport: http(BASE_RPC) });
  const { v, r, s, yParity } = parseSignature(sig);
  const vv = Number(v ?? BigInt(27 + (yParity ?? 0)));
  const hash = await withKeeperLock(async () => {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: USDC_BASE,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      args: [from, to, value, message.validAfter, message.validBefore, a.nonce, vv, r, s],
    });
    const h = await wallet.writeContract(request);
    const rc = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
    if (rc.status !== 'success') throw new Error('payment transfer reverted onchain');
    return h;
  });
  return { payer: from, amount: value.toString(), transaction: hash, explorer: `https://basescan.org/tx/${hash}`, network: 'base' };
}

/** Header value for X-PAYMENT-RESPONSE. */
export const paymentResponseHeader = (s: Settled) =>
  Buffer.from(JSON.stringify({ success: true, transaction: s.transaction, network: s.network, payer: s.payer })).toString('base64');
