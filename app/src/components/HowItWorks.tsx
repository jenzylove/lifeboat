function Lines({ x, y, lines, cls = 't-s', gap = 19 }: { x: number; y: number; lines: string[]; cls?: string; gap?: number }) {
  return (
    <text x={x} y={y} className={cls}>
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : gap}>{l}</tspan>)}
    </text>
  );
}

function Clock({ cx, cy, r = 30 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle className="pulse" cx={cx} cy={cy} r={r} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#FF4F00" strokeWidth="5" />
      <line x1={cx} y1={cy} x2={cx} y2={cy - r + 9} stroke="#FF4F00" strokeWidth="4" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="6s" repeatCount="indefinite" />
      </line>
      <circle cx={cx} cy={cy} r="4" fill="#FF4F00" />
    </g>
  );
}

const NODES = [
  { who: 'Dolphin model', cls: 'who-model', lines: ['decides stay, wait', 'or leave from the', 'full evidence pack'] },
  { who: 'Code', cls: 'who-code', lines: ['clamps the call:', 'hard rules win, only', 'approved vaults'] },
  { who: 'Contract', cls: 'who-contract', lines: ['moves your money', 'only between vaults', 'you approved'] },
  { who: 'You', cls: 'who-you', lines: ['can withdraw', 'anytime. Nobody', 'else can.'] },
];

export function HowItWorks() {
  return (
    <div className="how">
      {/* wide layout */}
      <svg className="desk" viewBox="0 0 1240 500" role="img" aria-label="How Lifeboat works: the feed goes quiet while the market falls, the clock opens, then either the curator acts and you stay, or the curator stays silent and the Dolphin model decides, code clamps, and the contract moves your money only between vaults you approved.">
        {/* 1: feed goes quiet */}
        <g className="s0">
          <text x="0" y="36" className="t-big">1  The feed goes quiet</text>
          <Lines x={0} y={64} lines={['The oracle keeps its old price', 'while the real market falls.']} />
          <text x="0" y="118" className="t-who who-code">Code reads both every minute</text>
          <line className="orc" x1="0" x2="280" y1="200" y2="200" />
          <text x="0" y="190" className="t-who who-model">oracle</text>
        </g>
        <path className="mkt fall" d="M0 200 C 90 200, 120 214, 160 240 S 240 300, 280 312" />
        <text x="214" y="334" className="t-who s1" style={{ fill: 'var(--fg2)' }}>market</text>
        <path className="s1" d="M0 200 C 90 200, 120 214, 160 240 S 240 300, 280 312 L280 200 Z" fill="var(--hot-soft)" />
        {/* 2: clock */}
        <g className="s2">
          <line className="line" x1="292" y1="256" x2="372" y2="256" />
          <Clock cx={410} cy={256} r={32} />
          <text x="330" y="36" className="t-big">2  The clock opens</text>
          <Lines x={330} y={64} lines={['Oracle 5% or more above the', 'market, a gap that holds for two minutes.']} />
          <text x="330" y="118" className="t-who who-code">Code opens it</text>
        </g>
        {/* fork */}
        <path className="line s3" d="M444 256 C 500 256, 510 190, 580 190" />
        <path className="line s4" d="M444 256 C 500 256, 510 330, 580 330" />
        {/* 3a curator acts */}
        <g className="s3">
          <circle cx="590" cy="190" r="6" fill="var(--sea)" />
          <text x="610" y="182" className="t-big">3a  Curator acts onchain</text>
          <Lines x={610} y={206} lines={['Cuts the cap or moves money away. Code sees the transaction.']} />
          <line className="sea" x1="1040" x2="1080" y1="176" y2="176" />
          <text x="1090" y="182" className="t-big" style={{ fill: 'var(--sea)' }}>You stay</text>
          <text x="1090" y="206" className="t-s">and keep earning</text>
        </g>
        {/* 3b curator silent */}
        <g className="s4">
          <circle cx="590" cy="330" r="6" fill="var(--hot)" />
          <text x="610" y="322" className="t-big">3b  Curator stays silent</text>
          <Lines x={610} y={346} lines={['No cap cut, no move. The clock keeps running.']} />
          <line className="hotl" x1="590" x2="1180" y1="388" y2="388" strokeDasharray="2 6" />
        </g>
        {NODES.map((n, i) => {
          const x = 610 + i * 160;
          return (
            <g key={n.who} className={`s${Math.min(6, 4 + Math.ceil(i / 2))}`}>
              <circle cx={x} cy={388} r={7} fill={i === 0 ? 'var(--hot)' : 'var(--bg)'} stroke={i === 0 ? 'var(--hot)' : 'var(--fg)'} strokeWidth="2" />
              <text x={x} y={418} className={`t-who ${n.cls}`}>{n.who}</text>
              <Lines x={x} y={438} lines={n.lines} gap={16} />
            </g>
          );
        })}
        {/* 4: the sweep */}
        <g className="s6">
          <line className="hotl" x1="0" x2="40" y1="392" y2="392" />
          <text x="0" y="420" className="t-big">+  The sweep</text>
          <Lines x={0} y={444} lines={['Dolphin also reads every market you hold next to every', 'break on the board, and catches the ones a price feed', 'can’t see (same issuer, wrapped or tranche tokens).']} gap={18} />
        </g>
      </svg>

      {/* phone layout */}
      <svg className="mob" viewBox="0 0 360 1160" role="img" aria-label="How Lifeboat works, step by step.">
        <g className="s0">
          <text x="0" y="30" className="t-big">1  The feed goes quiet</text>
          <Lines x={0} y={56} lines={['The oracle keeps its old price while', 'the real market falls.']} />
          <text x="0" y="104" className="t-who who-code">Code reads both every minute</text>
          <line className="orc" x1="0" x2="340" y1="140" y2="140" />
        </g>
        <path className="mkt fall" d="M0 140 C 110 140, 150 160, 200 190 S 300 225, 340 228" />
        <path className="s1" d="M0 140 C 110 140, 150 160, 200 190 S 300 225, 340 228 L340 140 Z" fill="var(--hot-soft)" />
        <g className="s2">
          <Clock cx={34} cy={300} r={26} />
          <text x="78" y="294" className="t-big">2  The clock opens</text>
          <Lines x={78} y={318} lines={['Oracle 5% or more above the', 'market, a gap that holds for two minutes.']} />
          <text x="78" y="360" className="t-who who-code">Code opens it</text>
        </g>
        <g className="s3">
          <line className="sea" x1="34" x2="34" y1="330" y2="420" />
          <circle cx="34" cy="426" r="6" fill="var(--sea)" />
          <text x="56" y="420" className="t-big">3a  Curator acts</text>
          <Lines x={56} y={444} lines={['Cuts the cap or moves money away.', 'Code sees the transaction.']} />
          <text x="56" y="496" className="t-big" style={{ fill: 'var(--sea)' }}>You stay and keep earning</text>
        </g>
        <g className="s4">
          <line className="hotl" x1="34" x2="34" y1="432" y2="560" strokeDasharray="2 6" />
          <circle cx="34" cy="566" r="6" fill="var(--hot)" />
          <text x="56" y="560" className="t-big">3b  Curator stays silent</text>
          <Lines x={56} y={584} lines={['No cap cut, no move. The clock', 'keeps running.']} />
          <line className="hotl" x1="34" x2="34" y1="572" y2="960" strokeDasharray="2 6" />
        </g>
        {NODES.map((n, i) => {
          const y = 660 + i * 92;
          return (
            <g key={n.who} className={`s${Math.min(6, 4 + Math.ceil(i / 2))}`}>
              <circle cx={34} cy={y - 5} r={7} fill={i === 0 ? 'var(--hot)' : 'var(--bg)'} stroke={i === 0 ? 'var(--hot)' : 'var(--fg)'} strokeWidth="2" />
              <text x={56} y={y} className={`t-who ${n.cls}`}>{n.who}</text>
              <Lines x={56} y={y + 22} lines={[n.lines.join(' ').replace(/(.{1,34})(\s|$)/g, '$1\n').trim().split('\n')].flat()} gap={18} />
            </g>
          );
        })}
        <g className="s6">
          <text x="0" y="1040" className="t-big">+  The sweep</text>
          <Lines x={0} y={1066} lines={['Dolphin also reads every market you hold', 'next to every break on the board, and', 'catches the ones a price feed can’t see', '(same issuer, wrapped or tranche tokens).']} gap={19} />
        </g>
      </svg>
      <div className="who-key">
        <span><b>Code</b>watches and clamps</span>
        <span><b className="hot-t">Dolphin model</b>makes the stay or leave call</span>
        <span><b className="sea-t">Contract</b>limits where money can go</span>
        <span><b>You</b>approve the vaults and can always withdraw</span>
      </div>
    </div>
  );
}
