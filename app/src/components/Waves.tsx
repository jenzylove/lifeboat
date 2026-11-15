function wave(amp: number, len: number, y: number, w = 2880, h = 220) {
  let d = `M0 ${y}`;
  for (let x = 0; x <= w; x += len) d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`;
  return `${d} L ${w} ${h} L 0 ${h} Z`;
}

export function Waves() {
  return (
    <div className="waves" aria-hidden="true">
      <svg className="w3" viewBox="0 0 2880 220" preserveAspectRatio="none" style={{ height: 160 }}><path d={wave(26, 360, 90)} fill="var(--wave2)" /></svg>
      <svg className="w2" viewBox="0 0 2880 220" preserveAspectRatio="none" style={{ height: 180 }}><path d={wave(34, 480, 80)} fill="var(--wave1)" /></svg>
      <svg className="w1" viewBox="0 0 2880 220" preserveAspectRatio="none" style={{ height: 150 }}><path d={wave(22, 288, 70)} fill="var(--bg2)" opacity=".9" /></svg>
    </div>
  );
}

export function Boat() {
  return (
    <svg className="hero-boat" viewBox="0 0 160 110" aria-hidden="true">
      <path d="M8 62 h144 l-18 34 q-3 6 -10 6 H36 q-7 0 -10 -6 Z" fill="#FF4F00" />
      <path d="M8 62 h144" stroke="var(--fg)" strokeWidth="3" />
      <rect x="46" y="34" width="68" height="28" rx="4" fill="#FF4F00" />
      <rect x="54" y="41" width="12" height="10" rx="2" fill="var(--bg)" />
      <rect x="74" y="41" width="12" height="10" rx="2" fill="var(--bg)" />
      <rect x="94" y="41" width="12" height="10" rx="2" fill="var(--bg)" />
      <path d="M80 34 V10" stroke="var(--fg)" strokeWidth="3" />
      <circle cx="80" cy="8" r="4" fill="var(--fg)">
        <animate attributeName="opacity" values="1;.2;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <path d="M22 76 h116" stroke="var(--bg)" strokeWidth="3" strokeDasharray="10 8" opacity=".5" />
    </svg>
  );
}
