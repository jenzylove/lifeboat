import { ReplayPlayer } from '@/components/ReplayPlayer';

export const metadata = { title: 'Replay March 22 · Lifeboat' };

export default function ReplayPage() {
  return (
    <main className="wrap">
      <div className="phead">
        <div className="eyebrow">Replay of real onchain data from Mar 22 2026</div>
        <h1 className="display" style={{ margin: '14px 0 18px' }}>The day the feed lied</h1>
        <p className="lede">A compromised key minted about 80 million unbacked Resolv USR. Morpho markets kept pricing wstUSR near $1.13 while it traded far lower, and lenders whose curators were slow ended up lending USDC against collateral worth a fraction of that. Press play to see the oracle, the market, the share borrowed, every curator transaction, and the minute Lifeboat would have left.</p>
      </div>
      <ReplayPlayer />
      <div style={{ height: 80 }} />
    </main>
  );
}
