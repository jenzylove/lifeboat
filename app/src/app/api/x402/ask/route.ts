import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAddress } from 'viem';
import { getVault } from '@engine/morphoApi';
import { paymentRequirements, verifyAndSettle, paymentResponseHeader, X402_PRICE_UNITS } from '@engine/x402';
import { askVault, cachedAnswer } from '@/lib/server/ask';
import { DATA_DIR } from '@/lib/server/config';
import { redact } from '@/lib/server/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Paid Ask Lifeboat, for agents and apps: GET /api/x402/ask?vault=0x...&chain=8453
 * No X-PAYMENT header: 402 with x402 payment terms ($0.01 USDC on Base).
 * With a valid X-PAYMENT (EIP-3009 authorization): settled onchain first, then the live Dolphin decision is returned
 * with X-PAYMENT-RESPONSE. The vault is checked before any payment is taken.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const vault = (url.searchParams.get('vault') ?? '').trim();
  const chain = Number(url.searchParams.get('chain') ?? 8453);
  const resource = `${url.origin}/api/x402/ask?vault=${vault}&chain=${chain}`;
  if (!isAddress(vault)) return NextResponse.json({ error: 'vault must be an address' }, { status: 400 });
  if (chain !== 8453 && chain !== 1) return NextResponse.json({ error: 'chain must be 8453 (Base) or 1 (Ethereum)' }, { status: 400 });

  const header = req.headers.get('x-payment');
  if (!header) {
    return NextResponse.json(paymentRequirements(resource, `Lifeboat: a live decision by the open model on Dolphin for Morpho vault ${vault}, explained by SERV Reasoning`), { status: 402 });
  }
  try {
    if (!(await getVault(chain as 8453 | 1, vault))) return NextResponse.json({ error: `No Morpho vault at ${vault}; no payment was taken.` }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: `Vault lookup failed, no payment was taken: ${redact(e)}` }, { status: 502 });
  }

  let settled;
  try {
    settled = await verifyAndSettle(header);
  } catch (e) {
    return NextResponse.json({ ...paymentRequirements(resource, 'Lifeboat live decision'), error: `Payment not accepted: ${redact(e)}` }, { status: 402 });
  }

  try {
    const cached = cachedAnswer(chain, vault);
    const answer = cached ? cached.answer : await askVault(chain as 8453 | 1, vault);
    const record = { at: Math.floor(Date.now() / 1000), vault, chain, price: X402_PRICE_UNITS.toString(), payment: settled, decision: answer ? { action: (answer as { record?: { decision?: { action?: string } } }).record?.decision?.action ?? null } : null, cached: !!cached };
    try {
      await fs.mkdir(path.join(DATA_DIR, 'payments'), { recursive: true });
      await fs.writeFile(path.join(DATA_DIR, 'payments', `${record.at}-${settled.transaction.slice(2, 12)}.json`), JSON.stringify(record, null, 1));
    } catch {}
    return NextResponse.json({ ...answer, cached: !!cached, ageS: cached?.ageS ?? 0, payment: settled }, { headers: { 'X-PAYMENT-RESPONSE': paymentResponseHeader(settled) } });
  } catch (e) {
    // Paid but the decision failed: say so plainly with the payment proof.
    return NextResponse.json({ error: `Payment settled but the decision failed: ${redact(e)}`, payment: settled }, { status: 502, headers: { 'X-PAYMENT-RESPONSE': paymentResponseHeader(settled) } });
  }
}
