import { BLOCK_TIME_S, getClient, readOraclePriceRaw } from './onchain.js';
import { type ChainId, type Result, ok, err } from './types.js';

export const SAMPLE_AGES_S = [0, 3600, 6 * 3600, 24 * 3600, 7 * 24 * 3600] as const;

export type ChangeBucket = '<1h' | '1h-6h' | '6h-24h' | '1d-7d' | '>=7d' | 'unknown';

export interface Sample {
  ageSeconds: number;
  block: bigint | null;
  raw: bigint | null;
  error?: string;
}

export interface Staleness {
  /** How long the price() output has been unchanged, bucketed by sampling. "<1h" = changed within the last hour. */
  lastChangeAgo: ChangeBucket;
  /** price() identical at all five samples (now, 1h, 6h, 24h, 7d): constant for 7 days. Inference from sampling, not a proof. */
  fixedByDesign: boolean;
  samples: Sample[];
}

/**
 * Pure: derive bucket from samples ordered by increasing age (first = now).
 * Sampling can miss an A->B->A move between two samples; the result is a bucket, not an exact timestamp.
 */
export function classifySamples(samples: Sample[]): Pick<Staleness, 'lastChangeAgo' | 'fixedByDesign'> {
  const cur = samples[0]?.raw;
  if (cur === null || cur === undefined) return { lastChangeAgo: 'unknown', fixedByDesign: false };
  const labels: ChangeBucket[] = ['<1h', '1h-6h', '6h-24h', '1d-7d']; // label for "changed between sample i-1 and i"
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    if (s.raw === null) return { lastChangeAgo: 'unknown', fixedByDesign: false }; // archive data missing: do not guess
    if (s.raw !== cur) return { lastChangeAgo: labels[i - 1]!, fixedByDesign: false };
  }
  return { lastChangeAgo: '>=7d', fixedByDesign: true };
}

/** Converts an age to a block height estimate using the chain's fixed block time. */
export function blockAtAge(latest: bigint, ageSeconds: number, chainId: ChainId): bigint {
  const back = BigInt(Math.floor(ageSeconds / BLOCK_TIME_S[chainId]));
  return back >= latest ? 1n : latest - back;
}

/**
 * Samples oracle.price() at now, -1h, -6h, -24h, -7d (needs an archive RPC for the older ones; publicnode
 * serves them for Base and Ethereum). Failed historical reads are recorded and turn the bucket into 'unknown'.
 */
export async function oracleStaleness(chainId: ChainId, oracle: string): Promise<Result<Staleness>> {
  const src = 'onchain:oracle.price() history';
  try {
    const latest = await getClient(chainId).getBlockNumber();
    const samples: Sample[] = await Promise.all(
      SAMPLE_AGES_S.map(async (age): Promise<Sample> => {
        const block = age === 0 ? latest : blockAtAge(latest, age, chainId);
        try {
          return { ageSeconds: age, block, raw: await readOraclePriceRaw(chainId, oracle, block) };
        } catch (e) {
          return { ageSeconds: age, block, raw: null, error: (e as Error).message.split('\n')[0] };
        }
      }),
    );
    if (samples[0]!.raw === null) return err(`oracle price() failed now: ${samples[0]!.error}`, src);
    return ok({ ...classifySamples(samples), samples }, src);
  } catch (e) {
    return err(e, src);
  }
}
