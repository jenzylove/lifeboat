/** Model clients. Dolphin makes the decision; SERV Reasoning writes the words people read. */

export const DOLPHIN_URL = process.env.DOLPHIN_BASE_URL ?? 'https://lighthouse.dphn.ai/run/text-v/v1';
export const DOLPHIN_MODEL = process.env.DOLPHIN_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash';
export const SERV_URL = process.env.SERV_BASE_URL ?? 'https://inference-api.openserv.ai/v1';
export const SERV_MODEL = process.env.SERV_MODEL ?? 'serv-swift';

/** USD per million tokens, from Dolphin's published price list. */
export const DOLPHIN_PRICE = { input: 0.01, output: 0.07 };

export interface LlmResult {
  text: string;
  model: string;
  /** 'dolphin' only when the call really went to Dolphin's endpoint; anything else is a stand-in */
  provider: 'dolphin' | 'serv' | 'stand-in';
  inputTokens: number;
  outputTokens: number;
  ms: number;
  costUsd: number | null;
}

interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function chat(url: string, key: string | undefined, body: object, extraHeaders: Record<string, string>, timeoutMs: number) {
  if (!key) throw new Error('missing API key');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
    return JSON.parse(txt);
  } finally {
    clearTimeout(t);
  }
}

/** Was this call actually served by Dolphin? Decided by the endpoint host, never by configuration labels. */
export const isDolphinHost = (url: string) => {
  try {
    return new URL(url).hostname.endsWith('dphn.ai');
  } catch {
    return false;
  }
};

export async function dolphin(messages: Msg[], opts: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {}): Promise<LlmResult> {
  const t0 = Date.now();
  const body: Record<string, unknown> = { model: DOLPHIN_MODEL, messages, [process.env.DOLPHIN_MAXTOK_PARAM ?? 'max_tokens']: opts.maxTokens ?? 6000 };
  if (!process.env.DOLPHIN_NO_TEMP) body.temperature = 0.2;
  if (opts.json) body.response_format = { type: 'json_object' };
  let j;
  try {
    j = await chat(DOLPHIN_URL, process.env.DOLPHIN_API_KEY, body, {}, opts.timeoutMs ?? 90_000);
  } catch (e) {
    // Some deployments reject response_format; retry once without it.
    if (opts.json && /response_format|400/.test(String(e))) {
      delete body.response_format;
      j = await chat(DOLPHIN_URL, process.env.DOLPHIN_API_KEY, body, {}, opts.timeoutMs ?? 90_000);
    } else throw e;
  }
  const inTok = j.usage?.prompt_tokens ?? 0;
  const outTok = j.usage?.completion_tokens ?? 0;
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    model: j.model ?? DOLPHIN_MODEL,
    provider: isDolphinHost(DOLPHIN_URL) ? 'dolphin' : 'stand-in',
    inputTokens: inTok,
    outputTokens: outTok,
    ms: Date.now() - t0,
    // Price only what Dolphin actually served; a stand-in's cost is not Dolphin's.
    costUsd: isDolphinHost(DOLPHIN_URL) ? (inTok * DOLPHIN_PRICE.input + outTok * DOLPHIN_PRICE.output) / 1e6 : null,
  };
}

export async function serv(messages: Msg[], opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<LlmResult> {
  const t0 = Date.now();
  const j = await chat(SERV_URL, process.env.SERV_API_KEY, { model: SERV_MODEL, messages, max_completion_tokens: opts.maxTokens ?? 800 }, {}, opts.timeoutMs ?? 90_000);
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    model: j.model ?? SERV_MODEL,
    provider: 'serv',
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
    ms: Date.now() - t0,
    costUsd: null,
  };
}

/** Pull the first JSON object out of model text (handles fences and leading prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fenced?.[1] ?? text;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in model output');
  return JSON.parse(s.slice(start, end + 1));
}
