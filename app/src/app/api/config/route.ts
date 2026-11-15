import { NextResponse } from 'next/server';
import { publicConfig } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(publicConfig());
}
