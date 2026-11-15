import type { MarketStatus } from '@/lib/types';
import { price, pct } from '@/lib/format';

/**
 * The feed line: oracle price as a flat orange dashed line, market price as a foam line.
 * The vertical gap between them is the live gap, exaggerated for visibility and clamped; shaded orange.
 * The foam line's ripple is decoration only; its level is the current market price.
 */
export function FeedLine({ oracle, market, gapPct, status, showCaption = true }: {
  oracle: number | null; market: number | null; gapPct: number | null; status: MarketStatus; showCaption?: boolean;
}) {
  const W = 300, H = 46, mid = 23;
  const known = gapPct !== null && Number.isFinite(gapPct);
  // 1% gap ~ 2.2px, 5% ~ 11px, capped at 18px each way.
  const off = known ? Math.max(-18, Math.min(18, gapPct! * 2.2)) : 0;
  const yO = mid - off / 2;
  const yM = mid + off / 2;
  const amp = status === 'clock' ? 2.4 : 1.4;
  let d = `M0 ${yM}`;
  // period 60 so the 120px drift loop is seamless
  for (let x = 0; x <= W + 120; x += 5) d += ` L${x} ${(yM + Math.sin((x / 60) * 2 * Math.PI) * amp).toFixed(2)}`;
  const fillOp = status === 'clock' ? 0.32 : status === 'watch' ? 0.16 : 0.06;
  return (
    <div>
      <svg className="feed" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={known ? `oracle ${price(oracle)}, market ${price(market)}, gap ${pct(gapPct, 2, true)}` : 'market price unavailable'}>
        <defs><clipPath id="fl-clip"><rect x="0" y="0" width={W} height={H} /></clipPath></defs>
        {known && <rect className="gapfill" x="0" y={Math.min(yO, yM)} width={W} height={Math.max(1, Math.abs(yM - yO))} opacity={fillOp} />}
        <line className="oracle" x1="0" x2={W} y1={yO} y2={yO} />
        {known ? (
          <g clipPath="url(#fl-clip)"><path className="market drift" d={d} /></g>
        ) : (
          <line x1="0" x2={W} y1={mid + 10} y2={mid + 10} stroke="currentColor" strokeOpacity=".3" strokeDasharray="1 5" strokeWidth="2" />
        )}
      </svg>
      {showCaption && (
        <div className="feedcap">
          <span className="o">oracle {price(oracle)}</span>
          <span>market {price(market)}</span>
          <span>gap {pct(gapPct, 2, true)}</span>
        </div>
      )}
    </div>
  );
}

export function ClockBadge({ label = 'Clock open' }: { label?: string }) {
  return (
    <span className="clockb">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ring" cx="12" cy="12" r="10" fill="none" stroke="#FF4F00" strokeWidth="2" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="#FF4F00" strokeWidth="2" />
        <line className="hand" x1="12" y1="12" x2="12" y2="5" stroke="#FF4F00" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.6" fill="#FF4F00" />
      </svg>
      {label}
    </span>
  );
}

export function StatusChip({ status }: { status: MarketStatus }) {
  if (status === 'clock') return <ClockBadge />;
  const words = { calm: 'calm', watch: 'watch', unknown: 'price unavailable' } as const;
  return <span className={`chip ${status}`}>{words[status]}</span>;
}
