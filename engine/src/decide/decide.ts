/** One decision cycle: evidence pack -> Dolphin -> clamp -> record. */
import { createHash } from 'node:crypto';
import { screenOutsideText, allowed, type GuardReport } from './guard.js';
import { buildPack, packToUserMessage, SYSTEM_PROMPT, type PackInput } from './evidence.js';
import { clamp, validateModel, type ClockState, type FinalDecision, type ModelDecision } from './policy.js';
import { dolphin, extractJson, serv, servJson, DECISION_SCHEMA, type LlmResult } from './llm.js';

export interface DecisionRecord {
  version: 1;
  mode: 'live' | 'replay' | 'drill' | 'ask' | 'bench';
  at: number;
  vault: string;
  marketId: string;
  clock: ClockState;
  evidence: ReturnType<typeof buildPack>['items'];
  model: { provider: string; model: string; inputTokens: number; outputTokens: number; ms: number; costUsd: number | null; raw: string } | null;
  /** SERV PromptGuard screening of every outside text before the model read it */
  guard?: GuardReport | null;
  /** SERV second opinion: runs when a real clock is open and the deciding model said STAY or WAIT; it can only make the call stricter */
  secondOpinion?: {
    firstAction?: string;
    model: string;
    provider: string;
    action: string | null;
    summary: string | null;
    reasons: { claim: string; evidence_ids: string[] }[];
    applied: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    ms: number;
  } | null;
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
  opts: { withNotice?: boolean; skipModel?: boolean; curatorUnknown?: boolean; skipGuard?: boolean; arm?: 'dolphin' | 'frontier'; frontierModel?: string; secondOpinion?: boolean } = {},
): Promise<DecisionRecord> {
  // Every string that came from outside (forum titles, vault, curator and token names) is screened by SERV PromptGuard first.
  let guard: GuardReport | null = null;
  if (!opts.skipGuard && !opts.skipModel) {
    guard = await screenOutsideText([
      ...pack.posts.map(p => ({ text: p.text, kind: 'forum post' })),
      { text: pack.user.vaultName, kind: 'vault name' },
      { text: pack.user.curator, kind: 'curator name' },
      { text: pack.collateral, kind: 'token symbol' },
      ...pack.candidates.map(c => ({ text: c.name, kind: 'vault name' })),
    ]);
    const g = guard;
    const safe = (t: string) => (allowed(g, t) ? t : '[text withheld: blocked or not screened by SERV PromptGuard]');
    pack = {
      ...pack,
      posts: pack.posts.filter(p => allowed(g, p.text)),
      user: { ...pack.user, vaultName: safe(pack.user.vaultName), curator: safe(pack.user.curator) },
      candidates: pack.candidates.map(c => ({ ...c, name: safe(c.name) })),
      related: [
        ...(pack.related ?? []),
        { ts: pack.now, text: `SERV PromptGuard screened ${g.checked} outside texts before you read them: ${g.passed} passed, ${g.blocked} blocked, ${g.unscreened} could not be screened and were withheld.`, source: 'SERV Reasoning (PromptGuard)' },
      ],
    };
  }
  const { items, ids } = buildPack(pack);
  let llm: LlmResult | null = null;
  let parsed: ModelDecision | null = null;
  let modelError: string | null = null;
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: packToUserMessage(items) },
  ];
  try {
    if (opts.skipModel) throw new Error('model wait in progress');
    type M = { role: 'system' | 'user' | 'assistant'; content: string }[];
    const call = (m: M) => (opts.arm === 'frontier' ? servJson(m, opts.frontierModel ?? 'claude-opus-5.5', DECISION_SCHEMA) : dolphin(m, { json: true }));
    llm = await call(messages);
    parsed = extractJson(llm.text) as ModelDecision;
    const bad = validateModel(parsed, ids);
    if (bad) {
      // One repair turn: tell the model exactly what was wrong. Still invalid -> the rules decide.
      const first = llm;
      llm = await call(
        [
          ...messages,
          { role: 'assistant' as const, content: first.text },
          { role: 'user' as const, content: `Invalid: ${bad}. Reply with only the JSON object with exactly these keys: action (STAY, WAIT or LEAVE), wait_minutes, target_vault, confidence, reasons (each {claim, evidence_ids}), summary.` },
        ],
      );
      llm = { ...llm, inputTokens: llm.inputTokens + first.inputTokens, outputTokens: llm.outputTokens + first.outputTokens, ms: llm.ms + first.ms, costUsd: llm.costUsd == null || first.costUsd == null ? null : llm.costUsd + first.costUsd };
      parsed = extractJson(llm.text) as ModelDecision;
    }
  } catch (e) {
    modelError = e instanceof Error ? e.message : String(e);
  }
  const latest = pack.reads[pack.reads.length - 1];
  if (!latest) throw new Error('decide needs at least one market read');
  let decision = clamp({
    now: pack.now,
    clock,
    latest,
    curatorActions: pack.curatorActions,
    candidates: pack.candidates.filter(c => c.openClocks === 0).map(c => c.address),
    model: parsed,
    modelError: opts.skipModel ? null : modelError,
    evidenceIds: ids,
    skipModel: opts.skipModel,
    curatorUnknown: opts.curatorUnknown,
  });
  // SERV second opinion. Only when a real clock is open (not an on demand check), only on STAY or WAIT from the model,
  // and it can only make the call stricter (STAY to WAIT or LEAVE, WAIT to LEAVE). Hard rules have already been applied.
  let secondOpinion: DecisionRecord['secondOpinion'] = null;
  const wantSecond = (opts.secondOpinion ?? (mode !== 'ask' && mode !== 'drill')) && !opts.skipModel && clock.openedAt != null;
  if (wantSecond && (decision.action === 'STAY' || decision.action === 'WAIT') && decision.decidedBy !== 'rule') {
    const rank = { STAY: 0, WAIT: 1, LEAVE: 2 } as const;
    const reviewModel = process.env.SERV_REVIEW_MODEL ?? 'claude-sonnet-5.5';
    try {
      const r = await servJson(
        [
          { role: 'system', content: SECOND_OPINION_PROMPT },
          { role: 'user', content: `${packToUserMessage(items)}\n\nFIRST MODEL DECIDED: ${decision.action}${decision.waitMinutes ? ` (${decision.waitMinutes} min)` : ''}\nITS REASONS: ${JSON.stringify(decision.model?.reasons ?? [])}` },
        ],
        reviewModel,
        DECISION_SCHEMA,
        { maxTokens: 2500 },
      );
      const op = extractJson(r.text) as ModelDecision;
      const bad = validateModel(op, ids);
      const stricter = !bad && rank[op.action] > rank[decision.action];
      secondOpinion = { firstAction: decision.action, model: r.model, provider: r.provider, action: op?.action ?? null, summary: op?.summary ?? null, reasons: op?.reasons ?? [], applied: stricter, error: bad, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, ms: r.ms };
      if (stricter) {
        const c = clamp({ now: pack.now, clock, latest, curatorActions: pack.curatorActions, candidates: pack.candidates.filter(x => x.openClocks === 0).map(x => x.address), model: op, modelError: null, evidenceIds: ids, curatorUnknown: opts.curatorUnknown });
        // Never let the clamp loosen it: keep the stricter action.
        if (rank[c.action] > rank[decision.action]) decision = { ...c, decidedBy: 'serv_second_opinion' as FinalDecision['decidedBy'] };
        else secondOpinion.applied = false;
      }
    } catch (e) {
      secondOpinion = { firstAction: decision.action, model: reviewModel, provider: 'serv', action: null, summary: null, reasons: [], applied: false, error: String(e instanceof Error ? e.message : e).split('\n')[0]!.slice(0, 160), inputTokens: 0, outputTokens: 0, costUsd: null, ms: 0 };
    }
  }
  const body = {
    version: 1 as const,
    mode,
    at: pack.now,
    vault: pack.user.vault,
    marketId: pack.marketId,
    clock,
    evidence: items,
    guard,
    secondOpinion,
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

export const SECOND_OPINION_PROMPT = `You are the second opinion for Lifeboat, an agent protecting one person's USDC in a Morpho lending vault.
A first model read the same evidence and decided STAY or WAIT. Your job is only to catch a missed danger: you may keep its call or make it stricter (STAY to WAIT or LEAVE, WAIT to LEAVE). Never make it looser.
Make it stricter only if the evidence shows real danger the first model underweighted: the oracle well above the real price and widening, borrowing climbing toward fully borrowed, curator silence, unbacked minting, or a related token breaking. Do not raise false alarms on calm markets or on fixed rate feeds with a small steady gap.
Every reason must cite evidence ids like "E3". Return only JSON with action, wait_minutes, target_vault (a candidate address or null), confidence, reasons, summary.`;

export interface TxOutcome {
  ok: boolean;
  explorer?: string;
  error?: string;
}

/**
 * The notice a person reads after an action. Code writes the headline from the transaction outcome;
 * SERV Reasoning explains why. mode 'replay' says what Lifeboat would have done.
 */
export async function noticeAfterTx(
  o: { action: 'LEAVE' | 'EXIT'; fromName: string; toName: string | null; tx: TxOutcome; mode?: 'live' | 'replay' | 'drill' },
  reasons: string[],
  evidence = '',
): Promise<{ text: string; provider: string; model: string } | null> {
  if (!process.env.SERV_API_KEY) return null;
  const dest = o.toName ? `into ${o.toName}` : 'into your Lifeboat account, where only you can withdraw it';
  const headline =
    o.mode === 'replay'
      ? `In this replay, Lifeboat moves the USDC out of ${o.fromName} and ${dest}.`
      : o.tx.ok
        ? `Lifeboat moved your USDC out of ${o.fromName} and ${dest}.${o.tx.explorer ? ` Transaction: ${o.tx.explorer}` : ''}`
        : `Lifeboat tried to move your USDC out of ${o.fromName} but the transaction did not go through; it will try again next minute.`;
  try {
    const r = await serv(
      [
        {
          role: 'system',
          content:
            'You explain an action that already happened. Write two or three short sentences, plain words, no jargon, no dashes, that tell a person why it was done, using only the reasons given. Do not restate the action, do not add facts, do not give advice.',
        },
        { role: 'user', content: [`Action: ${headline}`, 'Reasons:', ...reasons.map(w => `- ${w}`), ...(evidence ? ['Facts available:', evidence] : [])].join('\n') },
      ],
      { maxTokens: 2000 },
    );
    return { text: `${headline} ${r.text.trim()}`, provider: r.provider, model: r.model };
  } catch {
    return null;
  }
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
