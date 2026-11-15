import Link from 'next/link';
import { Mark } from './Nav';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div>
          <div className="brand"><Mark size={40} />Lifeboat</div>
          <p style={{ margin: '12px 0 0', maxWidth: '42ch' }}>Your USDC gets off before the vault sinks. Built for SERV Hackathon Edition 02, Dolphin track.</p>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Link href="/replay">Replay March 22</Link>
          <Link href="/app">Arm yours</Link>
          <Link href="/proof">Proof</Link>
          <a href="https://github.com/jenzylove/lifeboat" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </footer>
  );
}
