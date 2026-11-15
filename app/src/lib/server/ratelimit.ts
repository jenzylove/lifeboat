import 'server-only';

const buckets = new Map<string, number[]>();

/** Sliding window limiter in memory. Returns seconds to wait, or 0 when allowed (and records the hit). */
export function limit(key: string, max: number, windowMs: number): number {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return Math.ceil((windowMs - (now - hits[0]!)) / 1000); }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return 0;
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || req.headers.get('x-real-ip') || 'unknown';
}
