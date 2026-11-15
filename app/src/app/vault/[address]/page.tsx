import { VaultLive } from '@/components/VaultLive';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vault · Lifeboat' };

export default async function VaultPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ chain?: string }> }) {
  const { address } = await params;
  const { chain } = await searchParams;
  return <VaultLive address={address} chain={chain === '1' ? 1 : 8453} />;
}
