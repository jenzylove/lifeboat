import 'server-only';
import { parseAbiItem, type Address } from 'viem';
import { accountStatus, publicClient } from '@engine/keeper.js';
import { redact } from './redact';

const EXITED = parseAbiItem('event Exited(address indexed vault, uint256 assets, uint256 shares, address indexed by, bytes32 decisionHash, string reason)');
const DEPOSITED = parseAbiItem('event Deposited(address indexed vault, uint256 assets, uint256 shares, address indexed by)');
const LOOKBACK = 49_000n;

export interface HouseEvent {
  kind: 'Exited' | 'Deposited';
  vault: string;
  assets: number;
  by: string;
  decisionHash: string | null;
  reason: string | null;
  blockNumber: number;
  timestamp: number | null;
  txHash: string;
  explorer: string;
}

export async function houseEvents(account: Address): Promise<{ events: HouseEvent[]; fromBlock: number; toBlock: number }> {
  const head = await publicClient.getBlockNumber();
  const fromBlock = head > LOOKBACK ? head - LOOKBACK : 0n;
  const [ex, dep] = await Promise.all([
    publicClient.getLogs({ address: account, event: EXITED, fromBlock, toBlock: head }),
    publicClient.getLogs({ address: account, event: DEPOSITED, fromBlock, toBlock: head }),
  ]);
  const events: HouseEvent[] = [
    ...ex.map((l) => ({
      kind: 'Exited' as const, vault: l.args.vault!, assets: Number(l.args.assets ?? 0n) / 1e6, by: l.args.by!,
      decisionHash: l.args.decisionHash ?? null, reason: l.args.reason ?? null,
      blockNumber: Number(l.blockNumber), timestamp: null as number | null, txHash: l.transactionHash!, explorer: `https://basescan.org/tx/${l.transactionHash}`,
    })),
    ...dep.map((l) => ({
      kind: 'Deposited' as const, vault: l.args.vault!, assets: Number(l.args.assets ?? 0n) / 1e6, by: l.args.by!,
      decisionHash: null, reason: null,
      blockNumber: Number(l.blockNumber), timestamp: null as number | null, txHash: l.transactionHash!, explorer: `https://basescan.org/tx/${l.transactionHash}`,
    })),
  ].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 20);
  const blocks = [...new Set(events.map((e) => e.blockNumber))];
  const ts = new Map<number, number>();
  await Promise.all(blocks.map(async (b) => {
    try { ts.set(b, Number((await publicClient.getBlock({ blockNumber: BigInt(b) })).timestamp)); } catch {}
  }));
  for (const e of events) e.timestamp = ts.get(e.blockNumber) ?? null;
  return { events, fromBlock: Number(fromBlock), toBlock: Number(head) };
}

export async function houseSnapshot(account: Address) {
  const [status, ev] = await Promise.all([
    accountStatus(account),
    houseEvents(account).catch((e: Error) => ({ error: redact(e) })),
  ]);
  return { status, ...('error' in ev ? { events: [], eventsError: ev.error } : ev) };
}
