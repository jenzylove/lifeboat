import { toEventSelector } from 'viem';
import { getClient, BLOCK_TIME_S } from './onchain.js';
import { type ChainId, type Result, ok, err } from './types.js';

/**
 * Event signatures copied from the official sources:
 *  v1: morpho-org/metamorpho src/libraries/EventsLib.sol (Id is bytes32)
 *  v2: morpho-org/vault-v2 src/libraries/EventsLib.sol
 */
export const V1_EVENT_SIGNATURES = {
  SubmitCap: 'SubmitCap(address,bytes32,uint256)',
  SetCap: 'SetCap(address,bytes32,uint256)',
  SetSupplyQueue: 'SetSupplyQueue(address,bytes32[])',
  SetWithdrawQueue: 'SetWithdrawQueue(address,bytes32[])',
  ReallocateSupply: 'ReallocateSupply(address,bytes32,uint256,uint256)',
  ReallocateWithdraw: 'ReallocateWithdraw(address,bytes32,uint256,uint256)',
  SubmitMarketRemoval: 'SubmitMarketRemoval(address,bytes32)',
  RevokePendingCap: 'RevokePendingCap(address,bytes32)',
} as const;

export const V2_EVENT_SIGNATURES = {
  Allocate: 'Allocate(address,address,uint256,bytes32[],int256)',
  Deallocate: 'Deallocate(address,address,uint256,bytes32[],int256)',
  Submit: 'Submit(bytes4,bytes,uint256)',
  Accept: 'Accept(bytes4,bytes)',
  Revoke: 'Revoke(address,bytes4,bytes)',
  IncreaseAbsoluteCap: 'IncreaseAbsoluteCap(bytes32,bytes,uint256)',
  DecreaseAbsoluteCap: 'DecreaseAbsoluteCap(address,bytes32,bytes,uint256)',
  IncreaseRelativeCap: 'IncreaseRelativeCap(bytes32,bytes,uint256)',
  DecreaseRelativeCap: 'DecreaseRelativeCap(address,bytes32,bytes,uint256)',
} as const;

const toTopics = (sigs: Record<string, string>) =>
  Object.fromEntries(Object.entries(sigs).map(([k, s]) => [toEventSelector(s), k])) as Record<string, string>;

export const V1_TOPICS = toTopics(V1_EVENT_SIGNATURES);
export const V2_TOPICS = toTopics(V2_EVENT_SIGNATURES);

export interface CuratorEvent {
  kind: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  /** unix seconds; null if block timestamp lookup was skipped (cap) or failed */
  timestamp: number | null;
  /** indexed caller/sender when the event has one */
  caller: string | null;
  /** v1: indexed market Id for the event, when present */
  marketId: string | null;
}

export interface CuratorEvents {
  events: CuratorEvent[]; // newest first
  /** unix seconds of the newest matching event of ANY kind, null when none in the window */
  lastCuratorActionAt: number | null;
  /** newest curator/config action: caps, queues, removals, timelock submit/accept/revoke (not reallocations) */
  lastConfigActionAt: number | null;
  /** newest allocator action: Reallocate* (v1) / Allocate, Deallocate (v2). Bots make this frequent. */
  lastAllocatorActionAt: number | null;
  /** total matching events in the window; `events` is capped to maxEvents newest */
  totalEvents: number;
  fromBlock: number;
  toBlock: number;
  lookbackSeconds: number;
  /** number of eth_getLogs calls, and how many had to be split because the RPC rejected the range */
  rpcCalls: number;
  rpcSplits: number;
}

export interface FetchOpts {
  version?: 'v1' | 'v2';
  /** lookback in blocks. default = 7 days of blocks for the chain */
  blocks?: number;
  /** max blocks per eth_getLogs; publicnode caps Base at 50,000 */
  chunk?: number;
  concurrency?: number;
  maxTimestampLookups?: number;
  /** cap on returned events (newest first). default 500 */
  maxEvents?: number;
}

const ALLOCATOR_KINDS = new Set(['ReallocateSupply', 'ReallocateWithdraw', 'Allocate', 'Deallocate']);

interface RawLog { blockNumber: `0x${string}`; transactionHash: string; logIndex: `0x${string}`; topics: string[] }

const topicToAddr = (t: string | undefined) => (t ? `0x${t.slice(26)}` : null);

export async function fetchCuratorEvents(chainId: ChainId, vault: string, opts: FetchOpts = {}): Promise<Result<CuratorEvents>> {
  const src = 'eth_getLogs';
  try {
    const client = getClient(chainId);
    const version = opts.version ?? 'v1';
    const topicMap = version === 'v1' ? V1_TOPICS : V2_TOPICS;
    const head = Number(await client.getBlockNumber());
    const blocks = opts.blocks ?? Math.floor((7 * 24 * 3600) / BLOCK_TIME_S[chainId]);
    const from = Math.max(0, head - blocks);
    let chunk = opts.chunk ?? 45_000;
    const conc = opts.concurrency ?? 4;

    const ranges: [number, number][] = [];
    for (let s = from; s <= head; s += chunk) ranges.push([s, Math.min(head, s + chunk - 1)]);

    let rpcCalls = 0;
    let rpcSplits = 0;
    const getRange = async (a: number, b: number): Promise<RawLog[]> => {
      rpcCalls++;
      try {
        return (await client.request({
          method: 'eth_getLogs',
          params: [{ address: vault as `0x${string}`, fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}`, topics: [Object.keys(topicMap) as `0x${string}`[]] }],
        })) as unknown as RawLog[];
      } catch (e) {
        if (b - a < 500) throw e;
        rpcSplits++; // range or result size rejected: halve and retry
        const mid = Math.floor((a + b) / 2);
        return [...(await getRange(a, mid)), ...(await getRange(mid + 1, b))];
      }
    };

    const logs: RawLog[] = [];
    for (let i = 0; i < ranges.length; i += conc) {
      const part = await Promise.all(ranges.slice(i, i + conc).map(([a, b]) => getRange(a, b)));
      for (const p of part) logs.push(...p);
    }

    const events: CuratorEvent[] = logs
      .map((l) => ({
        kind: topicMap[l.topics[0]!] ?? 'unknown',
        blockNumber: parseInt(l.blockNumber, 16),
        txHash: l.transactionHash,
        logIndex: parseInt(l.logIndex, 16),
        timestamp: null as number | null,
        // v1 events: topic1 = caller. v2: Allocate/Deallocate/Revoke/Decrease* have indexed sender; others do not (checked below).
        caller: topicToAddr(l.topics[1]),
        marketId: version === 'v1' && l.topics[2] ? l.topics[2] : null,
      }))
      .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
    if (version === 'v2') {
      for (const e of events) {
        // topic1 of Submit/Accept is a bytes4 selector, IncreaseXCap topic1 is the cap id; those are not callers.
        if (['Submit', 'Accept', 'IncreaseAbsoluteCap', 'IncreaseRelativeCap'].includes(e.kind)) e.caller = null;
      }
    }

    const totalEvents = events.length;
    const firstOf = (pred: (e: CuratorEvent) => boolean) => events.find(pred);
    const firstConfig = firstOf((e) => !ALLOCATOR_KINDS.has(e.kind));
    const firstAlloc = firstOf((e) => ALLOCATOR_KINDS.has(e.kind));
    const keep = events.slice(0, opts.maxEvents ?? 500);
    const need = new Set([events[0]?.blockNumber, firstConfig?.blockNumber, firstAlloc?.blockNumber].filter((x): x is number => x !== undefined));
    const maxLookups = opts.maxTimestampLookups ?? 300;
    const uniq = [...new Set([...need, ...keep.map((e) => e.blockNumber)])].slice(0, maxLookups + 3);
    const ts = new Map<number, number>();
    for (let i = 0; i < uniq.length; i += 8) {
      await Promise.all(
        uniq.slice(i, i + 8).map(async (n) => {
          try {
            ts.set(n, Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp));
          } catch { /* leave null */ }
        }),
      );
    }
    for (const e of events) e.timestamp = ts.get(e.blockNumber) ?? null;

    return ok({
      events: keep, totalEvents,
      lastCuratorActionAt: events[0]?.timestamp ?? null,
      lastConfigActionAt: firstConfig?.timestamp ?? null,
      lastAllocatorActionAt: firstAlloc?.timestamp ?? null,
      fromBlock: from, toBlock: head, lookbackSeconds: blocks * BLOCK_TIME_S[chainId], rpcCalls, rpcSplits,
    }, src);
  } catch (e) {
    return err(e, src);
  }
}
