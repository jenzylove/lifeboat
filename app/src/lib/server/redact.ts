import 'server-only';

/** Error text safe to show: first line only, every URL replaced (RPC URLs can carry keys). */
export function redact(e: unknown): string {
  const s = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e ?? '');
  return (s.split(/\r?\n/)[0] ?? '')
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>)\]]+/gi, '[rpc]')
    .replace(/\b[a-z0-9.-]+\.(?:io|org|com|net|xyz|ai|dev|cloud|co|app)(?:\/[^\s"'<>)\]]*)?/gi, (m) => (/\//.test(m) ? '[rpc]' : m))
    .slice(0, 300);
}

/** Redact every string value of a { field: error } map. */
export function redactMap(m: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m ?? {})) out[k] = redact(v);
  return out;
}
