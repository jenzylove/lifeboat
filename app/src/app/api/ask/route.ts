import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { askVault, cachedAnswer } from '@/lib/server/ask';
import { redact } from '@/lib/server/redact';
import { clientIp, limit } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Ask Lifeboat now: a live decision by the open model on any Morpho vault. No transaction is ever sent. */
export async function POST(req: Request) {
  let body: { address?: unknown; chain?: unknown } = {};
  try { body = await req.json(); } catch {}
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const chain = Number(body.chain ?? 8453);
  if (!isAddress(address)) return NextResponse.json({ error: 'not a valid address' }, { status: 400 });
  if (chain !== 8453 && chain !== 1) return NextResponse.json({ error: 'chain must be 8453 (Base) or 1 (Ethereum)' }, { status: 400 });

  const cached = cachedAnswer(chain, address);
  if (cached) return NextResponse.json({ ...cached.answer, cached: true, ageS: cached.ageS });

  const wait = limit(`ask:${clientIp(req)}`, 3, 10 * 60_000);
  if (wait) return NextResponse.json({ error: `Three live checks per 10 minutes from one address. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'retry-after': String(wait) } });

  try {
    const a = await askVault(chain, address);
    if (!a) return NextResponse.json({ error: `No Morpho vault at ${address} on ${chain === 1 ? 'Ethereum' : 'Base'}.` }, { status: 404 });
    return NextResponse.json({ ...a, cached: false, ageS: 0 });
  } catch (e) {
    return NextResponse.json({ error: redact(e) }, { status: 502 });
  }
}
