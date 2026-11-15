import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assessVault } from '@engine/assess.js';
import type { ChainId } from '@engine/types.js';
import { boardOpenClocks, getVaultEntry } from './board';
import { DATA_DIR, publicConfig } from './config';
import { redact } from './redact';

const ANSWER_TTL_MS = 5 * 60_000;

export interface AskAnswer {
  ask: true;
  at: number;
  record: unknown;
  explanation: { text: string; provider: string; model: string } | null;
  vault: { address: string; name: string; curator: string | null; chainId: number };
  market: { id: string; collateral: string; gapPct: number | null; utilization: number | null; allocationUsd: number | null };
}

const g = globalThis as unknown as { __lbAsk?: Map<string, { at: number; a: AskAnswer }>; __lbAskInflight?: Map<string, Promise<AskAnswer | null>> };
const answers = (g.__lbAsk ??= new Map());
const inflight = (g.__lbAskInflight ??= new Map());

/** Cached answer for a vault, if any and fresh; with its age in seconds. */
export function cachedAnswer(chainId: number, address: string): { answer: AskAnswer; ageS: number } | null {
  const c = answers.get(`${chainId}:${address.toLowerCase()}`);
  if (!c || Date.now() - c.at > ANSWER_TTL_MS) return null;
  return { answer: c.a, ageS: Math.floor((Date.now() - c.at) / 1000) };
}

/** Live Dolphin decision on one vault. Null when the Morpho API does not know the vault. */
export async function askVault(chainId: ChainId, address: string): Promise<AskAnswer | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const entry = await getVaultEntry(chainId, address);
      if (!entry) return null;
      const cfg = publicConfig();
      const candidates = cfg.approvedVaults
        .filter((v) => v.address.toLowerCase() !== address.toLowerCase())
        .map((v) => ({ address: v.address, name: v.name, curator: '', apy: null, tvlUsd: null, openClocks: boardOpenClocks(v.address) }));
      const r = await assessVault(chainId, entry.snap.vault.address, candidates, entry.snap);
      const at = Math.floor(Date.now() / 1000);
      const answer: AskAnswer = { ask: true, at, record: { ...r.record, ask: true }, explanation: r.explanation, vault: r.vault, market: r.market };
      answers.set(key, { at: Date.now(), a: answer });
      if (answers.size > 300) answers.delete(answers.keys().next().value!);
      try {
        const dir = path.join(DATA_DIR, 'decisions');
        await fs.mkdir(dir, { recursive: true });
        const hash = String(r.record.hash ?? '').replace(/^0x/, '').slice(0, 10) || 'nohash';
        await fs.writeFile(path.join(dir, `${at}-${hash}.json`), JSON.stringify({ ...r.record, ask: true, explanation: r.explanation, notice: r.explanation, askVault: r.vault, askMarket: r.market }, null, 2));
      } catch {}
      return answer;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

export { redact };
