// Stream Finance xUSD (Nov 2025) replay for the Morpho Arbitrum xUSD/USDC market.
// Needs _stream_logs.json (stream_logs.mjs) and _stream_llama_xusd*.json (DefiLlama coins chart).
import fs from "fs";
import {marketState, oraclePrice, rpc, hex, blockAt, call} from "./rpc.mjs";
import {gql} from "./gql.mjs";
const D = "../../data/replay/";
const C = 42161, MB = "0x6c247b1F6182318877311737BaC0844bAa518F5e";
const ID = "0x9e90aec7d768403dacc9dd0d8320307fda3f980eed4df43e3e52168a1c667709";
const ORACLE = "0x1837efFC34Bb5a96EFdA00d53560799bE3a4226E";
const T0 = 1759968000 /* 2025-10-09 */, T1 = 1762560000 /* 2025-11-08 */;
const iso = ts => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
const r2 = x => x == null ? null : Math.round(x * 100) / 100, r4 = x => x == null ? null : Math.round(x * 10000) / 10000;
const LL = [...Object.values(JSON.parse(fs.readFileSync(D + "_stream_llama_xusd.json")).coins)[0].prices,
  ...Object.values(JSON.parse(fs.readFileSync(D + "_stream_llama_xusd_10m.json")).coins)[0].prices].sort((a, b) => a.timestamp - b.timestamp);
const nearest = (ts, gap) => { let b = null; for (const p of LL) { const d = Math.abs(p.timestamp - ts); if (d <= gap && (!b || d < Math.abs(b.timestamp - ts))) b = p; } return b; };

// grid: hourly over the window, 10-minute between Nov 3 00:00 and Nov 5 00:00
const grid = new Set();
for (let t = T0; t <= T1; t += 3600) grid.add(t);
for (let t = 1762128000; t <= 1762300800; t += 600) grid.add(t);
const times = [...grid].sort((a, b) => a - b);
const cacheF = D + "_stream_timeline_raw.json";
let raw = fs.existsSync(cacheF) ? JSON.parse(fs.readFileSync(cacheF)) : null;
if (!raw) {
  const a0 = await blockAt(C, T0); const h0 = await rpc(C, "eth_getBlockByNumber", [hex(a0), false]);
  const a1 = await blockAt(C, T1); const h1 = await rpc(C, "eth_getBlockByNumber", [hex(a1), false]);
  const rate = (a1 - a0) / (Number(h1.timestamp) - Number(h0.timestamp));
  raw = []; let i = 0;
  await Promise.all(Array.from({length: 8}, async () => { while (i < times.length) { const t = times[i++];
    for (let k = 0; k < 5; k++) { try {
      let b = Math.round(a0 + (t - Number(h0.timestamp)) * rate);
      let h = await rpc(C, "eth_getBlockByNumber", [hex(b), false]);
      b += Math.round((t - Number(h.timestamp)) * rate); h = await rpc(C, "eth_getBlockByNumber", [hex(b), false]);
      const s = await marketState(C, ID, b, MB); const p = await oraclePrice(C, ORACLE, b);
      raw.push({t, ts: Number(h.timestamp), block: b, supply: s.totalSupplyAssets.toString(), borrow: s.totalBorrowAssets.toString(), oracle: p == null ? null : p.toString()}); break;
    } catch (e) { await new Promise(r => setTimeout(r, 1000)); } } } }));
  raw.sort((a, b) => a.t - b.t); fs.writeFileSync(cacheF, JSON.stringify(raw));
}
const timeline = raw.map(r => {
  const sup = Number(r.supply) / 1e6, bor = Number(r.borrow) / 1e6, op = r.oracle == null ? null : Number(r.oracle) / 1e36;
  const p = nearest(r.ts, 1800);
  return {ts: iso(r.ts), unix: r.ts, block: r.block, oraclePrice: r4(op), marketPrice: p ? r4(p.price) : null, priceSource: p ? `DefiLlama coins chart xUSD (ethereum:0xE2Fc85BfB48C4cF147921fBE110cf92Ef9f26F94), point at ${iso(p.timestamp)}` : null,
    supplyAssets: r2(sup), borrowAssets: r2(bor), utilization: sup > 0 ? r4(bor / sup) : null, withdrawable: r2(sup - bor)};
});
// divergence from the full DefiLlama series against the oracle value at that time
let divergence = null;
for (const p of LL) { const row = timeline.find(r => r.unix >= p.timestamp) || timeline.at(-1); if (row.oraclePrice && (row.oraclePrice - p.price) / row.oraclePrice > 0.05) { divergence = {ts: iso(p.timestamp), unix: p.timestamp, oraclePrice: row.oraclePrice, marketPrice: r4(p.price), gap: r4((row.oraclePrice - p.price) / row.oraclePrice), source: "DefiLlama coins chart xUSD", nearestSampleBlock: row.block}; break; } }
const lastLiquid = [...timeline].reverse().find(r => r.utilization != null && r.utilization < 0.999);
const firstFull = lastLiquid ? timeline.find(r => r.unix > lastLiquid.unix) : timeline[0];

// events
const L = JSON.parse(fs.readFileSync(D + "_stream_logs.json"));
const T = {"0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0": "Supply", "0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf": "Withdraw", "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43": "Borrow", "0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09": "Repay", "0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184": "SupplyCollateral", "0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142": "WithdrawCollateral", "0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41": "Liquidate",
  "0xe86b6d3313d3098f4c5f689c935de8fde876a597c185def2cedab85efedac686": "SetCap", "0xe851bb5856808a50efd748be463b8f35bcfb5ec74c5bfde776fe0a4d2a26db27": "SubmitCap", "0x1026ceca5ed3747eb5edec555732d4a6f901ce1a875ecf981064628cadde1120": "RevokePendingCap", "0x89bf199df65bf65155e3e0a8abc4ad4a1be606220c8295840dba2ab5656c1f6d": "ReallocateSupply", "0xdd8bf5226dff861316e0fa7863fdb7dc7b87c614eb29a135f524eb79d5a1189a": "ReallocateWithdraw", "0x3240fc70754c5a2b4dab10bf7081a00024bfc8491581ee3d355360ec0dd91f16": "SubmitMarketRemoval"};
const w = (d, i) => BigInt("0x" + d.slice(2 + 64 * i, 2 + 64 * (i + 1)));
const addr = t => "0x" + t.slice(26).toLowerCase();
const drainEvents = [];
for (const l of L.blue) { const type = T[l.topics[0]]; if (!type) continue; const d = l.data; const e = {ts: iso(parseInt(l.blockTimestamp, 16)), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, type};
  if (type === "Supply" || type === "Repay") Object.assign(e, {caller: addr(l.topics[2]), onBehalf: addr(l.topics[3]), assets: r2(Number(w(d, 0)) / 1e6)});
  else if (type === "Withdraw" || type === "Borrow") Object.assign(e, {caller: "0x" + d.slice(26, 66), onBehalf: addr(l.topics[2]), receiver: addr(l.topics[3]), assets: r2(Number(w(d, 1)) / 1e6)});
  else if (type === "SupplyCollateral") Object.assign(e, {onBehalf: addr(l.topics[3]), collateralAssets: r2(Number(w(d, 0)) / 1e6)});
  else if (type === "WithdrawCollateral") Object.assign(e, {onBehalf: addr(l.topics[2]), collateralAssets: r2(Number(w(d, 1)) / 1e6)});
  else if (type === "Liquidate") Object.assign(e, {borrower: addr(l.topics[3]), repaidAssets: r2(Number(w(d, 0)) / 1e6), badDebtAssets: r2(Number(w(d, 3)) / 1e6)});
  drainEvents.push(e); }
drainEvents.sort((a, b) => a.block - b.block);

const vaddrs = [...new Set(L.mm.map(l => l.address.toLowerCase()))];
const api = await gql(`query($a:[String!]){vaults(first:100,where:{address_in:$a,chainId_in:[42161]}){items{address name state{curator curators{name}}}}}`, {a: vaddrs});
const info = new Map((api?.vaults?.items || []).map(v => [v.address.toLowerCase(), v]));
async function pos(v, block) { try { const r = await call(C, MB, "0x93c52062" + ID.slice(2) + v.slice(2).padStart(64, "0"), block); const sh = BigInt("0x" + r.slice(2, 66)); const s = await marketState(C, ID, block, MB); return s.totalSupplyShares === 0n ? 0 : r2(Number(sh * s.totalSupplyAssets / s.totalSupplyShares) / 1e6); } catch { return null; } }
const preRow = timeline.find(r => r.unix >= 1761955200); // Nov 1 00:00
const divRow = divergence ? (timeline.find(r => r.unix >= divergence.unix) || timeline.at(-1)) : null;
const endRow = timeline.at(-1);
const vaults = [];
for (const v of vaddrs) {
  const evs = L.mm.filter(l => l.address.toLowerCase() === v).map(l => { const type = T[l.topics[0]]; const det = {caller: addr(l.topics[1])};
    if (type === "SetCap" || type === "SubmitCap") det.cap = r2(Number(w(l.data, 0)) / 1e6);
    if (type === "ReallocateSupply") det.suppliedAssets = r2(Number(w(l.data, 0)) / 1e6);
    if (type === "ReallocateWithdraw") det.withdrawnAssets = r2(Number(w(l.data, 0)) / 1e6);
    return {ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, type, marketId: ID, detail: det}; }).sort((a, b) => a.block - b.block);
  const prot = evs.find(e => divergence && e.unix >= divergence.unix && ((e.type === "SetCap" && e.detail.cap === 0) || e.type === "SubmitMarketRemoval" || (e.type === "ReallocateWithdraw" && e.detail.withdrawnAssets > 0)));
  const protAny = evs.find(e => (e.type === "SetCap" && e.detail.cap === 0) || e.type === "SubmitMarketRemoval");
  const i = info.get(v);
  vaults.push({chain: "arbitrum", chainId: C, address: v, name: i?.name || null, curator: i?.state?.curators?.map(c => c.name).join(", ") || null, curatorAddress: i?.state?.curator || null,
    exposedMarkets: [{marketId: ID, vaultSupplyNov1: preRow ? await pos(v, preRow.block) : null, vaultSupplyAtDivergence: divRow ? await pos(v, divRow.block) : null, vaultSupplyEndOfWindow: await pos(v, endRow.block),
      marketWithdrawableAtDivergence: divRow?.withdrawable ?? null}],
    curatorEvents: evs.map(({unix, ...e}) => e),
    firstProtectiveActionTs: prot?.ts || null, firstProtectiveAction: prot ? {type: prot.type, tx: prot.tx, detail: prot.detail} : null,
    minutesFromDivergence: prot && divergence ? Math.round((prot.unix - divergence.unix) / 60) : null,
    firstCapToZeroOrRemovalAnyTime: protAny ? {ts: protAny.ts, type: protAny.type, tx: protAny.tx} : null,
    withdrawableAtDivergence: divRow?.withdrawable ?? null});
}
const out = {
  incident: {name: "Stream Finance xUSD collapse", date: "2025-11-04", summary: "Stream Finance disclosed a ~$93M loss by an external fund manager (Nov 4 2025); xUSD fell from ~$1.26 to ~$0.25 on secondary markets while the Morpho Arbitrum xUSD/USDC market oracle kept pricing xUSD at ~$1.266.",
    window: {from: iso(T0), to: iso(T1)}, divergenceRule: "first DefiLlama xUSD point where (oracle - market)/oracle > 5%", units: "USDC (6 decimals) for supply/borrow/withdrawable; USD per xUSD for prices"},
  sources: ["Morpho Blue Arbitrum 0x6c247b1F6182318877311737BaC0844bAa518F5e market(id), position(id,user) via arbitrum.gateway.tenderly.co at historical blocks", `Oracle ${ORACLE} price() at historical blocks`, "eth_getLogs via arbitrum.gateway.tenderly.co (Morpho Blue + MetaMorpho events, topic = market id)", "https://coins.llama.fi/chart/ethereum:0xE2Fc85BfB48C4cF147921fBE110cf92Ef9f26F94 (xUSD, 1h and 10m periods)", "https://api.morpho.org/graphql (market discovery, vault names)"],
  markets: [{chain: "arbitrum", chainId: C, marketId: ID, loan: {symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6}, collateral: {symbol: "xUSD", address: "0x6eAf19b2FC24552925dB245F9Ff613157a7dbb4C", decimals: 6}, oracle: ORACLE, lltv: 0.915, morphoBlue: MB,
    divergence, lastSampleBelowFullUtilization: lastLiquid ? {ts: lastLiquid.ts, utilization: lastLiquid.utilization, withdrawable: lastLiquid.withdrawable} : null, firstFullUtilizationSample: firstFull ? {ts: firstFull.ts, supplyAssets: firstFull.supplyAssets} : null,
    timeline: timeline.map(({unix, ...r}) => r), drainEvents}],
  vaults,
};
fs.writeFileSync(D + "stream-2025-11-04.json", JSON.stringify(out, null, 1));
console.log("samples", timeline.length, "div", JSON.stringify(divergence), "lastLiquid", JSON.stringify(out.markets[0].lastSampleBelowFullUtilization), "firstFull", JSON.stringify(out.markets[0].firstFullUtilizationSample));
for (const r of timeline.filter((r, k) => k % 48 === 0)) console.log(r.ts, r.oraclePrice, r.marketPrice, r.supplyAssets, r.borrowAssets, r.utilization);
for (const v of vaults) console.log(v.name, "|", v.curator, "| nov1", v.exposedMarkets[0].vaultSupplyNov1, "div", v.exposedMarkets[0].vaultSupplyAtDivergence, "end", v.exposedMarkets[0].vaultSupplyEndOfWindow, "| prot", v.firstProtectiveActionTs, v.firstProtectiveAction?.type, v.minutesFromDivergence, "| capZeroAny", JSON.stringify(v.firstCapToZeroOrRemovalAnyTime));
