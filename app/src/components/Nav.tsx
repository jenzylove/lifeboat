import Link from 'next/link';

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#FF4F00" strokeWidth="5" />
      <path d="M16 2.5v6M16 23.5v6M2.5 16h6M23.5 16h6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap">
        <Link href="/" className="brand"><Mark />Lifeboat</Link>
        <nav className="nav-links">
          <Link href="/#board" className="hide-s">Board</Link>
          <Link href="/replay">Replay</Link>
          <Link href="/#house" className="hide-s">House boat</Link>
          <Link href="/proof" className="hide-s">Proof</Link>
          <Link href="/app" className="btn hot small">Arm yours</Link>
        </nav>
      </div>
    </header>
  );
}
