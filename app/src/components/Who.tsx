import { whoDecided } from '@/lib/format';

/** Model or rule that made a call, straight from the record, with a clear badge when it was a stand-in model. */
export function Who({ decidedBy, model, provider, rule }: { decidedBy?: string | null; model?: string | null; provider?: string | null; rule?: string | null }) {
  const w = whoDecided(decidedBy, model, provider, rule);
  return (
    <>
      {w.text}
      {w.standIn && <span className="chip standin">stand-in model (not Dolphin)</span>}
    </>
  );
}
