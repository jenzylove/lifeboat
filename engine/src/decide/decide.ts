/** One decision cycle: evidence pack -> Dolphin -> clamp -> record. */
import { createHash } from 'node:crypto';
import { buildPack, packToUserMessage, SYSTEM_PROMPT, type PackInput } from './evidence.js';
import { clamp, validateModel, type ClockState, type FinalDecision, type ModelDecision } from './policy.js';
import { dolphin, extractJson, serv, type LlmResult } from './llm.js';

export interface DecisionRecord {
  version: 1;
  mode: 'live' | 'replay' | 'drill';
  at: number;
  vault: string;
  marketId: string;
  clock: ClockState;
  evidence: ReturnType<typeof buildPack>['items'];
  model: { provider: string; model: string; inputTokens: number; outputTokens: number; ms: number; costUsd: number | null; raw: string } | null;
  decision: FinalDecision;
  notice: { text: string; provider: string; model: string } | null;
  hash: string;
}

export function hashRecord(r: Omit<DecisionRecord, 'hash' | 'notice'>): string {
  return '0x' + createHash('sha256').update(JSON.stringify(r)).digest('hex');
}

export async function decide(
  pack: PackInput,
  clock: ClockState,
  mode: DecisionRecord['mode'],
  opts: { withNotice?: boolean } = {},
): Promise<DecisionRecord> {
  const { items, ids } = buildPack(pack);
  let llm: LlmResult | null = null;
  let parsed: ModelDecision | null = null;
  let modelError: string | null = null;
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: packToUserMessage(items) },
  ];
  try {
    llm = await dolphin(messages, { json: true });
    parsed = extractJson(llm.text) as ModelDecision;
    const bad = validateModel(parsed, ids);
    if (bad) {
      // One repair turn: tell the model exactly what was wrong. Still invalid -> the rules decide.
      const first = llm;
      llm = await dolphin(
        [
          ...messages,
          { role: 'assistant' as const, content: first.text },
          { role: 'user' as const, content: `Invalid: ${bad}. Reply with only the JSON object with exactly these keys: action (STAY, WAIT or LEAVE), wait_minutes, target_vault, confidence, reasons (each {claim, evidence_ids}), summary.` },
        ],
        { json: true },
      );
      llm = { ...llm, inputTokens: llm.inputTokens + first.inputTokens, outputTokens: llm.outputTokens + first.outputTokens, ms: llm.ms + first.ms, costUsd: llm.costUsd == null || first.costUsd == null ? null : llm.costUsd + first.costUsd };
      parsed = extractJson(llm.text) as ModelDecision;
    }
  } catch (e) {
    modelError = e instanceof Error ? e.message : String(e);
  }
  const latest = pack.reads[pack.reads.length - 1];
  if (!latest) throw new Error('decide needs at least one market read');
  const decision = clamp({
    now: pack.now,
    clock,
    latest,
    curatorActions: pack.curatorActions,
    candidates: pack.candidates.filter(c => c.openClocks === 0).map(c => c.address),
    model: parsed,
    modelError,
    evidenceIds: ids,
  });
  const body = {
    version: 1 as const,
    mode,
    at: pack.now,
    vault: pack.user.vault,
    marketId: pack.marketId,
    clock,
    evidence: items,
    model: llm ? { provider: llm.provider, model: llm.model, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, ms: llm.ms, costUsd: llm.costUsd, raw: llm.text } : null,
    decision,
  };
  const hash = hashRecord(body);
  let notice: DecisionRecord['notice'] = null;
  if (opts.withNotice && decision.action !== 'WAIT') {
    try {
      const target = pack.candidates.find(c => c.address === decision.targetVault)?.name ?? null;
      const n = await writeNotice(body.decision, items.map(i => `[${i.id}] ${i.text}`).join('\n'), pack.user.vaultName, target);
      notice = { text: n.text, provider: n.provider, model: n.model };
    } catch {
      notice = null;
    }
  }
  return { ...body, notice, hash };
}

/** Code states what happened; SERV Reasoning explains why in plain words. A model can never misstate where money went. */
export function noticeHeadline(d: FinalDecision, vaultName: string, targetName: string | null): string {
  if (d.action === 'LEAVE') return `Lifeboat moved your USDC out of ${vaultName}${targetName ? ` and into ${targetName}` : ' and is holding it in your account'}.`;
  if (d.action === 'STAY') return `Lifeboat kept your USDC in ${vaultName}.`;
  return `Lifeboat is watching ${vaultName} closely and will check again in ${d.waitMinutes} minutes.`;
}

export async function writeNotice(d: FinalDecision, evidence: string, vaultName: string, targetName: string | null = null) {
  const headline = noticeHeadline(d, vaultName, targetName);
  const why = [
    ...(d.rule ? [`Safety rule that fired: ${d.rule.replace(/_/g, ' ')}`] : []),
    ...(d.model?.reasons ?? []).map(r => r.claim),
  ];
  const r = await serv(
    [
      {
        role: 'system',
        content:
          'You explain an action that already happened. Write two or three short sentences, plain words, no jargon, no dashes, that tell a person why it was done, using only the reasons given. Do not restate the action, do not add facts, do not give advice.',
      },
      { role: 'user', content: `Action already taken: ${headline}\nReasons:\n${why.map(w => `- ${w}`).join('\n')}\nFacts available:\n${evidence}` },
    ],
    { maxTokens: 2000 },
  );
  return { ...r, text: `${headline} ${r.text.trim()}` };
}
