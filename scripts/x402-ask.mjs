// An agent paying for a Lifeboat check over x402: USDC on Base, no ETH needed by the payer.
// Usage: PAYER_KEY_FILE=path/to/key node scripts/x402-ask.mjs <vault> [base url]
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

const vault = process.argv[2];
const BASE = process.argv[3] ?? 'https://lifeboat.jdollar.site';
if (!vault) throw new Error('usage: node scripts/x402-ask.mjs <vault> [base url]');
const account = privateKeyToAccount(readFileSync(process.env.PAYER_KEY_FILE, 'utf8').trim());
const url = `${BASE}/api/x402/ask?vault=${vault}&chain=8453`;

// 1. Ask without paying: the server answers 402 with its terms.
const r1 = await fetch(url);
const terms = await r1.json();
if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}: ${JSON.stringify(terms)}`);
const req = terms.accepts[0];
console.log(`402: pay ${Number(req.maxAmountRequired) / 1e6} USDC to ${req.payTo} on ${req.network}`);

// 2. Sign an EIP-3009 transfer authorization for exactly that amount.
const now = Math.floor(Date.now() / 1000);
const authorization = { from: account.address, to: req.payTo, value: req.maxAmountRequired, validAfter: String(now - 60), validBefore: String(now + 300), nonce: '0x' + randomBytes(32).toString('hex') };
const signature = await account.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: 8453, verifyingContract: req.asset },
  types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
  primaryType: 'TransferWithAuthorization',
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});
const payment = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'base', payload: { signature, authorization } })).toString('base64');

// 3. Ask again with the payment: settled onchain, then the live decision comes back.
const r2 = await fetch(url, { headers: { 'X-PAYMENT': payment } });
const body = await r2.json();
console.log('status', r2.status);
console.log('payment', body.payment?.explorer ?? body.error);
const rec = body.record ?? {};
console.log('decision', rec.decision?.action, 'by', rec.model?.model, 'via', rec.model?.provider);
if (body.explanation?.text) console.log('SERV:', body.explanation.text);
