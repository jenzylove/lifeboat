import type { BoardMarket } from '@/lib/types';
import { FeedLine, StatusChip } from './FeedLine';
import { bucketWords, ratioPct, usd } from '@/lib/format';

function V({ v, label }: { v: string; label: string }) {
  return (
    <div>
      <span className="l">{label}</span>
      <span className={`v${v === 'unavailable' || v === 'history unavailable' ? ' na' : ''}`}>{v}</span>
    </div>
  );
}

export function Sources({ sources, errors }: { sources: Record<string, string>; errors: Record<string, string> }) {
  const s = Object.entries(sources);
  const e = Object.entries(errors);
  if (!s.length && !e.length) return null;
  return (
    <details className="src">
      <summary>where each number comes from</summary>
      <ul>
        {s.map(([k, v]) => <li key={k}><span>{k}:</span> {v}</li>)}
        {e.map(([k, v]) => <li key={`e-${k}`} className="err"><span>{k} unavailable:</span> {v}</li>)}
      </ul>
    </details>
  );
}

export function MarketRow({ m }: { m: BoardMarket }) {
  return (
    <div className="mrow">
      <div className="mcoll">
        {m.collateral}
        <StatusChip status={m.status} />
      </div>
      <div>
        <FeedLine oracle={m.oraclePrice} market={m.marketPrice} gapPct={m.gapPct} status={m.status} />
      </div>
      <div>
        <div className="mstats">
          <V label="Borrowed" v={ratioPct(m.utilization)} />
          <V label="Vault has here" v={usd(m.allocationUsd)} />
          <V label="Can leave now" v={usd(m.withdrawableUsd)} />
          <V label="Oracle price" v={m.oracleUnchangedFor ? (m.fixedByDesign ? 'fixed by design' : bucketWords[m.oracleUnchangedFor] ?? m.oracleUnchangedFor) : 'unavailable'} />
          <V label="Liquidation at" v={m.lltv === null ? 'unavailable' : ratioPct(m.lltv, 0)} />
          <V label="Free cash" v={usd(m.liquidityUsd)} />
        </div>
        <Sources sources={m.sources} errors={m.errors} />
      </div>
    </div>
  );
}
