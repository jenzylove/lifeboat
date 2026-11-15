import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, REPLAY_DIR } from './config';
import type { DecisionSummary } from '@/lib/types';
import { buildDecisions, buildIncident, type Incident, type ReplayPayload } from '@/lib/replayView';

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

type Rec = Record<string, any>;

export function summarize(r: Rec, file: string): DecisionSummary | null {
  if (!r || typeof r !== 'object' || !r.decision) return null;
  const d = r.decision as Rec;
  return {
    file,
    hash: String(r.hash ?? ''),
    at: Number(r.at ?? 0),
    mode: String(r.mode ?? 'live'),
    vault: String(r.vault ?? ''),
    marketId: String(r.marketId ?? ''),
    action: String(d.action ?? ''),
    decidedBy: String(d.decidedBy ?? ''),
    rule: d.rule ?? null,
    targetVault: d.targetVault ?? null,
    model: r.model
      ? { provider: r.model.provider, model: r.model.model, inputTokens: r.model.inputTokens, outputTokens: r.model.outputTokens, costUsd: r.model.costUsd ?? null, ms: r.model.ms }
      : null,
    modelError: d.modelError ?? null,
    summary: d.model?.summary ?? null,
    notice: r.notice?.text ?? null,
    evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : 0,
  };
}

/** Decision records written by the watcher into DATA_DIR/decisions/*.json, newest first. */
export async function listDecisions(limit = 200): Promise<{ decisions: DecisionSummary[]; dir: string; error: string | null }> {
  const dir = path.join(DATA_DIR, 'decisions');
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return { decisions: [], dir: 'decisions', error: null };
  }
  const out: DecisionSummary[] = [];
  for (const n of names) {
    try {
      const j = await readJson(path.join(dir, n));
      const arr = Array.isArray(j) ? j : [j];
      for (const r of arr) { const s = summarize(r as Rec, n); if (s) out.push(s); }
    } catch {}
  }
  out.sort((a, b) => b.at - a.at);
  return { decisions: out.slice(0, limit), dir: 'decisions', error: null };
}

export async function getDecision(hash: string): Promise<unknown | null> {
  const dir = path.join(DATA_DIR, 'decisions');
  let names: string[] = [];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json')); } catch { return null; }
  for (const n of names) {
    try {
      const j = await readJson(path.join(dir, n));
      for (const r of Array.isArray(j) ? j : [j]) if ((r as Rec)?.hash === hash) return r;
    } catch {}
  }
  return null;
}

/** Replay incidents + the Dolphin replay run. Only data/replay/decisions.json is read for decisions
 * (REPLAY_DECISIONS_FILE may point elsewhere for local development; it is unset in production). Cached by mtime. */
const INCIDENT_FILES: [string, string][] = [['resolv', 'resolv-2026-03-22.json'], ['stream', 'stream-2025-11-04.json']];
const replayCache = new Map<string, { mtime: number; v: unknown }>();
async function cachedJson(file: string): Promise<unknown | null> {
  try {
    const st = await fs.stat(file);
    const c = replayCache.get(file);
    if (c && c.mtime === st.mtimeMs) return c.v;
    const v = await readJson(file);
    replayCache.set(file, { mtime: st.mtimeMs, v });
    return v;
  } catch { return null; }
}
export async function readReplay(): Promise<ReplayPayload> {
  const dir = REPLAY_DIR;
  const errors: Record<string, string> = {};
  const incidents: Incident[] = [];
  for (const [id, name] of INCIDENT_FILES) {
    const j = await cachedJson(path.join(dir, name));
    if (!j) { errors[name] = 'not present yet'; continue; }
    const inc = buildIncident(id, name, j);
    if (inc) incidents.push(inc); else errors[name] = 'no market timeline in file';
  }
  const dFile = process.env.REPLAY_DECISIONS_FILE ? path.resolve(process.env.REPLAY_DECISIONS_FILE) : path.join(dir, 'decisions.json');
  const raw = await cachedJson(dFile);
  return { incidents, decisions: raw ? buildDecisions(raw) : null, decisionsFile: path.basename(dFile), errors };
}
