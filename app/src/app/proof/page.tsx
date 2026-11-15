import { Contracts, Decisions } from '@/components/Proof';
import { WatcherProof } from '@/components/Watcher';

export const metadata = { title: 'Proof · Lifeboat' };

export default function ProofPage() {
  return (
    <main className="wrap">
      <div className="phead">
        <div className="eyebrow">Everything you can check</div>
        <h1 className="display" style={{ margin: '14px 0 18px' }}>Proof</h1>
        <p className="lede">The contracts that hold the money, the tests behind them, and every decision Lifeboat has made, with the model, the tokens it read, what it cost, and whether the model or a hard rule made the call.</p>
      </div>
      <div className="stat-row">
        <div><div className="bignum">9</div><div className="small dim">contract tests on a Base mainnet fork</div></div>
        <div><div className="bignum">43</div><div className="small dim">engine unit tests</div></div>
      </div>
      <section className="section" style={{ paddingTop: 40 }}>
        <h2 className="display" style={{ fontSize: 'clamp(36px,5vw,64px)', marginBottom: 20 }}>Contracts</h2>
        <Contracts />
        <p className="small dim" style={{ marginTop: 18, maxWidth: '70ch' }}>The keeper can call exit and move. Exit pulls money from a vault back into the account; move does that and then deposits into another vault the owner approved. Neither can send money to any other address. Only the owner can withdraw, sweep, pause the keeper or change the approved list.</p>
      </section>
      <section className="section" style={{ paddingTop: 40 }}>
        <h2 className="display" style={{ fontSize: 'clamp(36px,5vw,64px)', marginBottom: 20 }}>The watcher</h2>
        <WatcherProof />
      </section>
      <section className="section" style={{ paddingTop: 40 }}>
        <h2 className="display" style={{ fontSize: 'clamp(36px,5vw,64px)', marginBottom: 20 }}>Decision records</h2>
        <Decisions limit={200} />
      </section>
    </main>
  );
}
