'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, createWalletClient, custom, maxUint256, parseUnits, zeroAddress, zeroHash, type Address, type Hash } from 'viem';
import { base } from 'viem/chains';
import { ACCOUNT_ABI, ERC20_ABI, FACTORY_ABI, VAULT_ABI } from '@/lib/abi';
import { useConfig } from './Proof';
import { short, usd } from '@/lib/format';
import { Loading } from './Board';

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (...a: any[]) => void) => void; removeListener?: (e: string, f: (...a: any[]) => void) => void };
declare global { interface Window { ethereum?: Eth } }


interface Pos { vault: Address; name: string; allowed: boolean; assets: number; withdrawable: number }
interface Acct { address: Address; exists: boolean; paused: boolean; idle: number; positions: Pos[] }

export function ArmApp() {
  const cfg = useConfig();
  const [eth, setEth] = useState<Eth | null>(null);
  const [me, setMe] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [acct, setAcct] = useState<Acct | null>(null);
  const [bal, setBal] = useState<number | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [amount, setAmount] = useState('1');
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; hash: Hash } | null>(null);

  useEffect(() => { setEth(window.ethereum ?? null); }, []);
  useEffect(() => {
    if (!cfg) return;
    setPick(Object.fromEntries(cfg.approvedVaults.map((v) => [v.address, true])));
    setTarget(cfg.approvedVaults[0]?.address ?? '');
  }, [cfg]);

  const wallet = useMemo(() => (eth && me ? createWalletClient({ account: me, chain: base, transport: custom(eth) }) : null), [eth, me]);
  // Reads go through the connected wallet's own provider (no public RPC from the browser). Before connect, only /api/config is used.
  const pub = useMemo(() => (eth && me && chainId === 8453 ? createPublicClient({ chain: base, transport: custom(eth) }) : null), [eth, me, chainId]);

  const refresh = useCallback(async () => {
    if (!me || !cfg?.factory || !pub) return;
    const factory = cfg.factory as Address;
    const [existing, predicted, b] = await Promise.all([
      pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'accountOf', args: [me] }),
      pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'predict', args: [me] }),
      pub.readContract({ address: cfg.usdc as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [me] }),
    ]);
    setBal(Number(b) / 1e6);
    if (existing === zeroAddress) { setAcct({ address: predicted, exists: false, paused: false, idle: 0, positions: [] }); return; }
    const [paused, vaults, idle] = await Promise.all([
      pub.readContract({ address: existing, abi: ACCOUNT_ABI, functionName: 'keeperPaused' }),
      pub.readContract({ address: existing, abi: ACCOUNT_ABI, functionName: 'vaults' }),
      pub.readContract({ address: cfg.usdc as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [existing] }),
    ]);
    const positions = await Promise.all(vaults.map(async (v) => {
      const [p, name, allowed] = await Promise.all([
        pub.readContract({ address: existing, abi: ACCOUNT_ABI, functionName: 'positionOf', args: [v] }),
        pub.readContract({ address: v, abi: VAULT_ABI, functionName: 'name' }).catch(() => short(v)),
        pub.readContract({ address: existing, abi: ACCOUNT_ABI, functionName: 'allowedVault', args: [v] }),
      ]);
      return { vault: v, name, allowed, assets: Number(p[1]) / 1e6, withdrawable: Number(p[2]) / 1e6 };
    }));
    setAcct({ address: existing, exists: true, paused, idle: Number(idle) / 1e6, positions });
    const firstAllowed = positions.find((p) => p.allowed);
    if (firstAllowed) setTarget((t) => (positions.some((p) => p.vault === t && p.allowed) ? t : firstAllowed.vault));
  }, [me, cfg, pub]);

  useEffect(() => { refresh().catch((e: Error) => setErr(e.message.split('\n')[0]!)); }, [refresh]);

  useEffect(() => {
    if (!eth?.on) return;
    const onAcc = (a: string[]) => setMe((a[0] as Address) ?? null);
    const onChain = (c: string) => setChainId(parseInt(c, 16));
    eth.on('accountsChanged', onAcc); eth.on('chainChanged', onChain);
    return () => { eth.removeListener?.('accountsChanged', onAcc); eth.removeListener?.('chainChanged', onChain); };
  }, [eth]);

  const connect = async () => {
    if (!eth) return;
    setErr(null);
    try {
      const a = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      setMe((a[0] as Address) ?? null);
      setChainId(parseInt((await eth.request({ method: 'eth_chainId' })) as string, 16));
    } catch (e) { setErr((e as Error).message); }
  };

  const toBase = async () => {
    if (!eth) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] });
      } else { setErr((e as Error).message); return; }
    }
    setChainId(parseInt((await eth.request({ method: 'eth_chainId' })) as string, 16));
  };

  const run = async (label: string, fn: () => Promise<Hash>) => {
    setBusy(label); setErr(null);
    try {
      const hash = await fn();
      setLastTx({ label, hash });
      if (!pub) throw new Error('Switch your wallet to Base to continue.');
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== 'success') throw new Error(`${label} reverted onchain`);
      await refresh();
    } catch (e) {
      setErr(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split('\n')[0]!);
    } finally { setBusy(null); }
  };

  if (!cfg) return <Loading text="Loading" />;
  if (!cfg.factory) {
    return (
      <div className="notice hot">
        <b>Launching shortly.</b> The Lifeboat factory on Base is being deployed. Once it is live you can create your account here with one transaction. Until then, watch the <a href="/#board">live board</a> or try the <a href="/replay">March 22 replay</a>.
      </div>
    );
  }

  const onBase = chainId === 8453;
  const chosen = cfg.approvedVaults.filter((v) => pick[v.address]).map((v) => v.address as Address);
  const amt = Number(amount);
  const amtOk = Number.isFinite(amt) && amt >= 1 && (bal === null || amt <= bal);
  const step = !me ? 1 : !onBase ? 2 : !acct ? 3 : !acct.exists ? 3 : acct.positions.every((p) => p.assets < 0.01) && acct.idle < 0.01 ? 4 : 5;
  const cls = (n: number) => `step${step > n ? ' done' : step === n ? ' now' : ''}`;

  return (
    <div className="steps">
      {!eth && <div className="notice hot">No browser wallet found. Open this page in a browser with a wallet extension, or inside your wallet app&apos;s browser.</div>}

      <div className={cls(1)}>
        <div className="n">1</div>
        <div>
          <h3>Connect your wallet</h3>
          {me ? <p className="mono">{me}</p> : <><p>Any browser wallet with USDC on Base.</p><button className="btn hot" onClick={connect} disabled={!eth}>Connect wallet</button></>}
        </div>
      </div>

      <div className={cls(2)}>
        <div className="n">2</div>
        <div>
          <h3>Switch to Base</h3>
          {me && !onBase ? <button className="btn hot" onClick={toBase}>Switch to Base</button> : <p>{onBase ? 'You are on Base.' : 'After you connect.'}</p>}
          {me && onBase && bal !== null && <p className="mono small">Wallet USDC: {usd(bal, 2)}</p>}
        </div>
      </div>

      <div className={cls(3)}>
        <div className="n">3</div>
        <div>
          <h3>Create your account</h3>
          {acct && <p>Your account address {acct.exists ? 'is' : 'will be'} <a className="mono" href={`https://basescan.org/address/${acct.address}`} target="_blank" rel="noreferrer">{acct.address}</a></p>}
          {acct && !acct.exists && onBase && (
            <>
              <p>Tick the vaults Lifeboat may use. It can only ever move your money between these.</p>
              <p className="small dim">The keeper that watches for you is <a className="mono" href={`https://basescan.org/address/${cfg.keeper}`} target="_blank" rel="noreferrer">{cfg.keeper ? short(cfg.keeper) : 'not set'}</a>. It can only call exit and move between the vaults below; it can never send money anywhere else.</p>
              {cfg.approvedVaults.map((v) => (
                <label className="check" key={v.address}>
                  <input type="checkbox" checked={!!pick[v.address]} onChange={(e) => setPick({ ...pick, [v.address]: e.target.checked })} />
                  {v.name} <a className="mono tiny faint" href={`https://basescan.org/address/${v.address}`} target="_blank" rel="noreferrer">{short(v.address)}</a>
                </label>
              ))}
              {chosen.length < 2 && <p className="small hot-t">Pick at least two, so there is somewhere safe to park.</p>}
              <button className="btn hot" disabled={!!busy || chosen.length < 2} onClick={() => run('Create account', () => wallet!.writeContract({ address: cfg.factory as Address, abi: FACTORY_ABI, functionName: 'create', args: [chosen] }))}>
                {busy === 'Create account' ? 'Creating…' : 'Create my account'}
              </button>
            </>
          )}
          {!acct && (
            <>
              <p>One transaction from your wallet. The account will only be able to use these vaults:</p>
              {cfg.approvedVaults.map((v) => <p key={v.address} className="small" style={{ margin: '0 0 4px' }}>{v.name} <a className="mono tiny faint" href={`https://basescan.org/address/${v.address}`} target="_blank" rel="noreferrer">{short(v.address)}</a></p>)}
              <p className="small dim" style={{ marginTop: 10 }}>Keeper: <a className="mono" href={`https://basescan.org/address/${cfg.keeper}`} target="_blank" rel="noreferrer">{cfg.keeper ? short(cfg.keeper) : 'not set'}</a>. It can only call exit and move between those vaults, never send money anywhere else.</p>
            </>
          )}
          {acct?.exists && <p className="sea-t small">Created.</p>}
        </div>
      </div>

      <div className={cls(4)}>
        <div className="n">4</div>
        <div>
          <h3>Put money in</h3>
          {acct?.exists ? (
            <>
              <p>Send USDC to your account, then park it in a vault. Minimum $1.</p>
              <div className="field">
                <span className="mono">$</span>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in USDC" />
                <button className="btn hot" disabled={!!busy || !amtOk} onClick={() => run('Send USDC', () => wallet!.writeContract({ address: cfg.usdc as Address, abi: ERC20_ABI, functionName: 'transfer', args: [acct.address, parseUnits(amount, 6)] }))}>
                  {busy === 'Send USDC' ? 'Sending…' : 'Send to my account'}
                </button>
              </div>
              {!amtOk && <p className="small hot-t">{amt < 1 ? 'Minimum is $1.' : 'More than your wallet holds.'}</p>}
              <p className="small dim" style={{ marginTop: 14 }}>Idle in the account: <span className="mono">{usd(acct.idle, 2)}</span></p>
              {acct.idle > 0 && (
                <div className="field">
                  <select value={target} onChange={(e) => setTarget(e.target.value)} className="paste-row" style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--rule2)', padding: 8, borderRadius: 6 }}>
                    {acct.positions.filter((p) => p.allowed).map((p) => <option key={p.vault} value={p.vault}>{p.name}</option>)}
                  </select>
                  <button className="btn hot" disabled={!!busy || !target} onClick={() => run('Park in vault', () => wallet!.writeContract({ address: acct.address, abi: ACCOUNT_ABI, functionName: 'deposit', args: [target as Address, maxUint256] }))}>
                    {busy === 'Park in vault' ? 'Parking…' : 'Park it in this vault'}
                  </button>
                </div>
              )}
            </>
          ) : <p>After your account exists.</p>}
        </div>
      </div>

      <div className={cls(5)}>
        <div className="n">5</div>
        <div>
          <h3>Your position</h3>
          {acct?.exists ? (
            <>
              {acct.positions.map((p) => (
                <div className="pos" key={p.vault}>
                  <span className="n">{p.name}{!p.allowed && <span className="faint small"> (no longer approved)</span>}</span>
                  <span className="a">{usd(p.assets, 2)}<br /><span className="tiny faint">{usd(p.withdrawable, 2)} can leave now</span></span>
                  {p.assets > 0 && (
                    <span style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button className="btn small" disabled={!!busy} onClick={() => run('Exit to account', () => wallet!.writeContract({ address: acct.address, abi: ACCOUNT_ABI, functionName: 'exit', args: [p.vault, zeroHash, 'owner exit'] }))}>Exit to account</button>
                      <button className="btn small" disabled={!!busy} onClick={() => run('Withdraw to wallet', () => wallet!.writeContract({ address: acct.address, abi: ACCOUNT_ABI, functionName: 'ownerRedeemAll', args: [p.vault] }))}>Withdraw to wallet</button>
                    </span>
                  )}
                </div>
              ))}
              <div className="pos">
                <span className="n">Idle in the account</span>
                <span className="a">{usd(acct.idle, 2)}</span>
                {acct.idle > 0 && <span style={{ gridColumn: '1 / -1' }}><button className="btn small" disabled={!!busy} onClick={() => run('Withdraw idle', () => wallet!.writeContract({ address: acct.address, abi: ACCOUNT_ABI, functionName: 'withdraw', args: [maxUint256] }))}>Withdraw idle to wallet</button></span>}
              </div>
              <div style={{ marginTop: 18, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" disabled={!!busy} onClick={() => run('Toggle keeper', () => wallet!.writeContract({ address: acct.address, abi: ACCOUNT_ABI, functionName: 'setKeeperPaused', args: [!acct.paused] }))}>
                  {acct.paused ? 'Turn the keeper back on' : 'Pause the keeper'}
                </button>
                <span className="small dim">Keeper is {acct.paused ? 'paused: Lifeboat will not move anything.' : 'on watch.'}</span>
              </div>
            </>
          ) : <p>After your account exists.</p>}
        </div>
      </div>

      {busy && <p className="mono small dim">{busy}: confirm in your wallet, then wait for Base to include it.</p>}
      {lastTx && <p className="small">Last transaction: {lastTx.label} · <a href={`https://basescan.org/tx/${lastTx.hash}`} target="_blank" rel="noreferrer" className="mono">{short(lastTx.hash, 6)}</a></p>}
      {err && <div className="errbox">{err}</div>}
    </div>
  );
}
