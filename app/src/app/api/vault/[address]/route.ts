import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getVaultView } from '@/lib/server/board';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const chain = Number(new URL(req.url).searchParams.get('chain') ?? 8453);
  if (!isAddress(address)) return NextResponse.json({ error: 'not a valid address' }, { status: 400 });
  if (chain !== 8453 && chain !== 1) return NextResponse.json({ error: 'chain must be 8453 (Base) or 1 (Ethereum)' }, { status: 400 });
  try {
    return NextResponse.json(await getVaultView(chain, address));
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0]!;
    return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 502 });
  }
}
