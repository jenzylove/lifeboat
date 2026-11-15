import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getVaultView } from '@/lib/server/board';
import { redact } from '@/lib/server/redact';
import { clientIp, limit } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const chain = Number(new URL(req.url).searchParams.get('chain') ?? 8453);
  if (!isAddress(address)) return NextResponse.json({ error: 'not a valid address' }, { status: 400 });
  if (chain !== 8453 && chain !== 1) return NextResponse.json({ error: 'chain must be 8453 (Base) or 1 (Ethereum)' }, { status: 400 });
  const wait = limit(`vault:${clientIp(req)}`, 6, 60_000);
  if (wait) return NextResponse.json({ error: `Too many vault reads from this address; try again in ${wait} seconds.` }, { status: 429, headers: { 'retry-after': String(wait) } });
  try {
    const v = await getVaultView(chain, address);
    if (!v) return NextResponse.json({ error: `No Morpho vault at ${address} on ${chain === 1 ? 'Ethereum' : 'Base'}.` }, { status: 404 });
    return NextResponse.json(v);
  } catch (e) {
    return NextResponse.json({ error: redact(e) }, { status: 502 });
  }
}
