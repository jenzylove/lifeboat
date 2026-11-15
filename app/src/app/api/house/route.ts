import { NextResponse } from 'next/server';
import { houseAccount } from '@/lib/server/config';
import { houseSnapshot } from '@/lib/server/house';
import { drillGate } from '@/lib/server/drill';
import { redact } from '@/lib/server/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const account = houseAccount();
  if (!account) return NextResponse.json({ configured: false });
  try {
    const [snap, gate] = await Promise.all([houseSnapshot(account), drillGate(account)]);
    return NextResponse.json({ configured: true, account, explorer: `https://basescan.org/address/${account}`, ...snap, drill: gate });
  } catch (e) {
    return NextResponse.json({ configured: true, account, error: redact(e) }, { status: 502 });
  }
}
