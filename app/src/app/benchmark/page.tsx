import { Benchmark } from '@/components/Benchmark';
import { GuardCheck } from '@/components/Guard';

export const metadata = { title: 'Benchmark · Lifeboat' };

export default function BenchmarkPage() {
  return (
    <main className="wrap">
      <div className="phead">
        <div className="eyebrow">Benchmark on real incidents and live markets</div>
        <h1 className="display" style={{ margin: '14px 0 18px' }}>Does the cheap open model make the right call?</h1>
      </div>
      <Benchmark />
      <section className="section" style={{ paddingTop: 48, marginTop: 56 }}>
        <h2 className="display" style={{ fontSize: 'clamp(36px,5vw,64px)', marginBottom: 20 }}>Can a forum post talk it out of leaving?</h2>
        <p className="lede" style={{ marginBottom: 24 }}>Every outside text Lifeboat reads goes through SERV PromptGuard first. Here is how it did on planted attacks and honest posts.</p>
        <GuardCheck />
      </section>
      <div style={{ height: 80 }} />
    </main>
  );
}
