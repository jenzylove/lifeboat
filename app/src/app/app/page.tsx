import { ArmApp } from '@/components/ArmApp';

export const metadata = { title: 'Arm yours · Lifeboat' };

export default function AppPage() {
  return (
    <main className="wrap">
      <div className="phead">
        <div className="eyebrow">Base · USDC · from $1</div>
        <h1 className="display" style={{ margin: '14px 0 18px' }}>Arm your Lifeboat</h1>
        <p className="lede">Your own account, owned by your wallet. The agent can only move your money between the vaults you tick below. You can pause it or take everything back at any time.</p>
      </div>
      <ArmApp />
      <div style={{ height: 80 }} />
    </main>
  );
}
