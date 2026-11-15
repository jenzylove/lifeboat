// Builds data/replay/resolv-2026-03-22.json from the raw onchain pulls.
// Inputs (all produced by sibling scripts): _markets_raw.json (Morpho API), _timeline_raw.json (timeline.mjs),
// _curve_fine.json (curvefine.mjs), _logs.json (logs.mjs), _queues.json (queues.mjs), _pa_all.json (pa_all.mjs),
// _vaults_api.json (vaultinfo.mjs), _llama_*.json (DefiLlama coins chart).
import fs from "fs";
import {call} from "./rpc.mjs";
const D = "../../data/replay/";
const J = f => JSON.parse(fs.readFileSync(D + f));
const RAW = J("_markets_raw.json").markets.items;
const TL = J("_timeline_raw.json");
const CF = fs.existsSync(D + "_curve_fine.json") ? J("_curve_fine.json") : [];
const L = J("_logs.json");
const Q = J("_queues.json");
const PAALL = J("_pa_all.json");
const VAPI = J("_vaults_api.json");
const llama = f => { try { const j = J(f); return Object.values(j.coins)[0].prices; } catch { return []; } };
const LL_RLP = llama("_llama_ethereum_0x4956b52aE2fF65D74CA2d61207523288e4528f96.json");
const LL_USR = llama("_llama_ethereum_0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110.json");

const PA = { 1: "0xfd32fa2ca22c76dd6e550706ad913fc6ce91c75d", 8453: "0xa090dd1a701408df1d4d0b85b716c87565f90467" };
const IDS = {
  1: ["0xd9e34b1eed46d123ac1b69b224de1881dbc88798bc7b70f504920f62f58f28cc", "0xe1b65304edd8ceaea9b629df4c3c926a37d1216e27900505c04f14b2ed279f33", "0x8e7cc042d739a365c43d0a52d5f24160fa7ae9b7e7c9a479bd02a56041d4cf77", "0x4b86442549b52826e0fc11770ec5154450cb3c5c14dc751a761d81dcfbe7a7b2"],
  8453: ["0xff0f2bd52ca786a4f8149f96622885e880222d8bed12bbbf5950296be8d03f89"],
};
const T = {
  Supply: "0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0",
  Withdraw: "0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf",
  Borrow: "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43",
  Repay: "0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09",
  SupplyCollateral: "0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184",
  WithdrawCollateral: "0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142",
  Liquidate: "0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41",
  SetCap: "0xe86b6d3313d3098f4c5f689c935de8fde876a597c185def2cedab85efedac686",
  SubmitCap: "0xe851bb5856808a50efd748be463b8f35bcfb5ec74c5bfde776fe0a4d2a26db27",
  RevokePendingCap: "0x1026ceca5ed3747eb5edec555732d4a6f901ce1a875ecf981064628cadde1120",
  SetSupplyQueue: "0x6ce31538fc7fba95714ddc8a275a09252b4b1fb8f33d2550aa58a5f62ad934de",
  SetWithdrawQueue: "0xe0c2db6b54586be6d7d49943139fccf0dd315ba63e55364a76c73cd8fdba724d",
  ReallocateSupply: "0x89bf199df65bf65155e3e0a8abc4ad4a1be606220c8295840dba2ab5656c1f6d",
  ReallocateWithdraw: "0xdd8bf5226dff861316e0fa7863fdb7dc7b87c614eb29a135f524eb79d5a1189a",
  SubmitMarketRemoval: "0x3240fc70754c5a2b4dab10bf7081a00024bfc8491581ee3d355360ec0dd91f16",
  PublicReallocateTo: "0xf8ae80b0854dfc3c73d3eb4b6160df1996a5859e6c1d11d10f3980a7f4691991",
  PublicWithdrawal: "0x6218cdb9e8efb3d0e8136d32c91d9446eaf19e2e486bc67dfcb3d574ca60d504",
  SetFlowCaps: "0x709e1cb4b0ac458eb1c1a9c708e841ee963b229247afbf1437bd39e01ae4aa14",
};
const NAME = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
const w = (data, i) => BigInt("0x" + data.slice(2 + 64 * i, 2 + 64 * (i + 1)));
const addr = t => "0x" + t.slice(26).toLowerCase();
const iso = ts => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
const num = (x, dec) => Number(x) / 10 ** dec;
const r2 = x => x == null ? null : Math.round(x * 100) / 100;
const r4 = x => x == null ? null : Math.round(x * 10000) / 10000;

function nearest(arr, ts, maxGap) {
  let best = null;
  for (const p of arr) { const d = Math.abs(p.timestamp - ts); if (d <= maxGap && (!best || d < Math.abs(best.timestamp - ts))) best = p; }
  return best;
}
// Ethereum curve USR quote nearest in time (for Base USR market cross-chain reference)
const ethRows = (TL["1"] || []).filter(Boolean);
function curveUsrAt(ts) {
  let best = null;
  for (const r of ethRows) if (r.curveUSR1000 && (!best || Math.abs(r.ts - ts) < Math.abs(best.ts - ts))) best = r;
  return best && Math.abs(best.ts - ts) <= 900 ? Number(best.curveUSR1000) / 1e9 : null;
}

const SRC_CURVE = "Curve USR/USDC pool 0x3eE841F47947FEFbE510366E4bbb49e145484195 get_dy(USR->USDC, 1000 USR)/1000, onchain at the same block";
const SRC_WST = SRC_CURVE + " x wstUSR.convertToAssets(1e18) (USR per wstUSR) at the same block";

const out = {
  incident: {
    name: "Resolv USR unbacked mint",
    date: "2026-03-22",
    summary: "Compromised Resolv minting key minted ~80M unbacked USR; USR depegged on secondary markets while Morpho oracles that hardcode USR = $1 (USR, wstUSR via exchange rate, RLP via Resolv feed) kept pricing collateral at par. Borrowers posted cheap collateral and borrowed USDC/AUSD at oracle value until supplied liquidity hit 100% utilization.",
    window: { from: iso(1774094400), to: iso(1774310400) },
    divergenceRule: "first sample where (oraclePrice - marketPrice) / oraclePrice > 5%",
    protectiveActionRule: "first vault event on that market that reduces or stops exposure: SetCap to 0, SubmitMarketRemoval, ReallocateWithdraw initiated by an allocator that is not the Public Allocator, SetSupplyQueue dropping the market, or SetFlowCaps on the Public Allocator setting maxIn to 0 for that market",
    units: "supplyAssets/borrowAssets/withdrawable are in loan token units (USDC/AUSD, ~USD). oraclePrice/marketPrice are USD per 1 collateral token.",
  },
  sources: [
    "Morpho Blue 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb market(id) and position(id,user) eth_call at historical blocks (Ethereum via eth.drpc.org; Base via base.drpc.org)",
    "Oracle price() eth_call at historical blocks (MorphoChainlinkOracleV2 contracts listed per market)",
    "Logs via eth_getLogs on mainnet.gateway.tenderly.co / base.gateway.tenderly.co (Morpho Blue, MetaMorpho vaults, PublicAllocator 0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D / Base 0xA090dD1a701408Df1d4d0B85b716c87565f90467)",
    SRC_CURVE,
    "https://coins.llama.fi/chart/ethereum:0x4956b52aE2fF65D74CA2d61207523288e4528f96 (RLP, 10m period, sparse)",
    "https://coins.llama.fi/chart/ethereum:0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110 (USR, cross-check)",
    "https://api.morpho.org/graphql (market discovery by collateral, vault names/curators)",
    "https://www.theblock.co/post/394582 (incident narrative: 80M USR minted)",
    "https://oakresearch.io/en/analyses/investigations/the-resolv-usr-hack-curators-face-their-responsibilities (curator narrative, cross-check only)",
  ],
  markets: [],
  vaults: [],
};

// ---------- markets ----------
const marketMeta = {};
for (const c of ["1", "8453"]) for (const id of IDS[c]) {
  const m = RAW.find(x => x.marketId === id);
  const ld = m.loanAsset.decimals, cd = m.collateralAsset.decimals;
  const coll = m.collateralAsset.symbol;
  const rows = (TL[c] || []).filter(Boolean).sort((a, b) => a.ts - b.ts);
  const timeline = rows.filter(r => r.markets?.[id]).map(r => {
    const s = r.markets[id];
    const sup = num(s.supply, ld), bor = num(s.borrow, ld);
    const op = s.oracle == null ? null : num(s.oracle, 36 + ld - cd);
    let mp = null, src = null;
    if (coll === "wstUSR" && r.curveUSR1000) { mp = Number(r.curveUSR1000) / 1e9 * Number(r.wstRate) / 1e18; src = SRC_WST; }
    else if (coll === "USR" && c === "1" && r.curveUSR1000) { mp = Number(r.curveUSR1000) / 1e9; src = SRC_CURVE; }
    else if (coll === "USR" && c === "8453") { mp = curveUsrAt(r.ts); src = mp == null ? null : "Ethereum " + SRC_CURVE + ", nearest Ethereum block within 15 min (cross-chain reference, no deep Base USR pool read)"; }
    else if (coll === "RLP") { const p = nearest(LL_RLP, r.ts, 1800); if (p) { mp = p.price; src = `DefiLlama coins chart RLP, point at ${iso(p.timestamp)} (nearest within 30 min)`; } }
    return { ts: iso(r.ts), unix: r.ts, block: r.block, oraclePrice: r4(op), marketPrice: r4(mp), priceSource: src, supplyAssets: r2(sup), borrowAssets: r2(bor), utilization: sup > 0 ? r4(bor / sup) : null, withdrawable: r2(sup - bor) };
  });
  // divergence: use fine curve series for USR/wstUSR on Ethereum when available
  let divergence = null;
  const gap = r => r.oraclePrice && r.marketPrice != null ? (r.oraclePrice - r.marketPrice) / r.oraclePrice : null;
  if ((coll === "USR" || coll === "wstUSR") && CF.length) {
    const rate = coll === "wstUSR" ? Number(rows.find(r => r.wstRate)?.wstRate) / 1e18 : 1;
    const orc = timeline[0]?.oraclePrice;
    for (const f of CF) { const mp = f.usrPerUsdc * rate; if (orc && (orc - mp) / orc > 0.05) { divergence = { ts: iso(f.ts), unix: f.ts, block: f.block, oraclePrice: orc, marketPrice: r4(mp), gap: r4((orc - mp) / orc), source: "per-minute Curve sample (curvefine.mjs)" + (c === "8453" ? "; Ethereum block, applied to Base market" : "") }; break; } }
  }
  if (!divergence) for (const r of timeline) { const g = gap(r); if (g != null && g > 0.05) { divergence = { ts: r.ts, unix: r.unix, block: r.block, oraclePrice: r.oraclePrice, marketPrice: r.marketPrice, gap: r4(g), source: "10-minute timeline sample" }; break; } }
  const preRow = timeline.find(r => r.unix >= 1774137600) || timeline[0];
  const at = u => { let b = null; for (const r of timeline) if (r.unix <= u) b = r; return b; };
  const fullUtil = timeline.find(r => divergence && r.unix >= divergence.unix && r.utilization >= 0.999);

  // drain events
  const blue = L[c].blue.filter(l => l.topics[1] === id && NAME[l.topics[0]] && NAME[l.topics[0]] !== "AccrueInterest");
  const drainEvents = [];
  for (const l of blue) {
    const type = NAME[l.topics[0]]; const d = l.data; let e = { ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, type };
    if (type === "Supply") Object.assign(e, { caller: addr(l.topics[2]), onBehalf: addr(l.topics[3]), assets: r2(num(w(d, 0), ld)) });
    else if (type === "Withdraw") Object.assign(e, { caller: "0x" + d.slice(26, 66), onBehalf: addr(l.topics[2]), receiver: addr(l.topics[3]), assets: r2(num(w(d, 1), ld)) });
    else if (type === "Borrow") Object.assign(e, { caller: "0x" + d.slice(26, 66), onBehalf: addr(l.topics[2]), receiver: addr(l.topics[3]), assets: r2(num(w(d, 1), ld)) });
    else if (type === "Repay") Object.assign(e, { caller: addr(l.topics[2]), onBehalf: addr(l.topics[3]), assets: r2(num(w(d, 0), ld)) });
    else if (type === "SupplyCollateral") Object.assign(e, { caller: addr(l.topics[2]), onBehalf: addr(l.topics[3]), collateralAssets: r4(num(w(d, 0), cd)) });
    else if (type === "WithdrawCollateral") Object.assign(e, { caller: "0x" + d.slice(26, 66), onBehalf: addr(l.topics[2]), receiver: addr(l.topics[3]), collateralAssets: r4(num(w(d, 1), cd)) });
    else if (type === "Liquidate") Object.assign(e, { caller: addr(l.topics[2]), borrower: addr(l.topics[3]), repaidAssets: r2(num(w(d, 0), ld)), seizedCollateral: r4(num(w(d, 2), cd)), badDebtAssets: r2(num(w(d, 3), ld)) });
    drainEvents.push(e);
  }
  for (const l of L[c].pa.filter(l => l.topics[3] === id)) {
    const type = NAME[l.topics[0]];
    drainEvents.push({ ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, type, sender: addr(l.topics[1]), vault: addr(l.topics[2]), assets: r2(num(w(l.data, 0), ld)) });
  }
  drainEvents.sort((a, b) => a.block - b.block);
  const after = drainEvents.filter(e => divergence && e.unix >= divergence.unix);
  const sum = (arr, t, f = "assets") => r2(arr.filter(e => e.type === t).reduce((s, e) => s + (e[f] || 0), 0));
  const paIn = after.filter(e => e.type === "PublicReallocateTo");
  const stats = {
    borrowedAfterDivergence: sum(after, "Borrow"),
    borrowTxAfterDivergence: after.filter(e => e.type === "Borrow").length,
    collateralPostedAfterDivergence: r4(after.filter(e => e.type === "SupplyCollateral").reduce((s, e) => s + e.collateralAssets, 0)),
    suppliedAfterDivergence: sum(after, "Supply"),
    publicAllocatorInflowAfterDivergence: r2(paIn.reduce((s, e) => s + e.assets, 0)),
    publicAllocatorTxAfterDivergence: paIn.length,
    lastPublicAllocatorInflow: paIn.length ? paIn.at(-1).ts : null,
    publicAllocatorInflowByVault: Object.fromEntries(Object.entries(paIn.reduce((m, e) => (m[e.vault] = (m[e.vault] || 0) + e.assets, m), {})).map(([k, v]) => [k, r2(v)])),
    badDebtRealized: sum(drainEvents, "Liquidate", "badDebtAssets"),
    firstBorrowAfterDivergence: after.find(e => e.type === "Borrow")?.ts || null,
    lastBorrowInWindow: after.filter(e => e.type === "Borrow").at(-1)?.ts || null,
  };
  const mk = {
    chain: c === "1" ? "ethereum" : "base", chainId: +c, marketId: id,
    loan: { symbol: m.loanAsset.symbol, address: m.loanAsset.address, decimals: ld },
    collateral: { symbol: coll, address: m.collateralAsset.address, decimals: cd },
    oracle: m.oracle.address, lltv: Number(m.lltv) / 1e18, morphoBlue: m.morphoBlue.address,
    preIncident: preRow ? { ts: preRow.ts, supplyAssets: preRow.supplyAssets, borrowAssets: preRow.borrowAssets, oraclePrice: preRow.oraclePrice } : null,
    divergence, fullUtilizationAfterDivergence: fullUtil ? { ts: fullUtil.ts, block: fullUtil.block, supplyAssets: fullUtil.supplyAssets, borrowAssets: fullUtil.borrowAssets } : null,
    end: timeline.at(-1) ? { ts: timeline.at(-1).ts, supplyAssets: timeline.at(-1).supplyAssets, borrowAssets: timeline.at(-1).borrowAssets, utilization: timeline.at(-1).utilization } : null,
    stats, timeline, drainEvents,
  };
  marketMeta[c + ":" + id] = { mk, at, ld };
  out.markets.push(mk);
}

// ---------- vaults ----------
const vaultEvents = {};
const push = (c, v, e) => ((vaultEvents[c + ":" + v] ||= []).push(e));
for (const c of ["1", "8453"]) {
  const pa = PA[c];
  for (const l of L[c].mm) {
    const type = NAME[l.topics[0]], v = l.address.toLowerCase(), id = l.topics[2], caller = addr(l.topics[1]);
    const ld = marketMeta[c + ":" + id]?.ld ?? 6;
    let detail = { caller, viaPublicAllocator: caller === pa };
    if (type === "SetCap" || type === "SubmitCap") detail.cap = r2(num(w(l.data, 0), ld));
    if (type === "ReallocateSupply") detail.suppliedAssets = r2(num(w(l.data, 0), ld));
    if (type === "ReallocateWithdraw") detail.withdrawnAssets = r2(num(w(l.data, 0), ld));
    push(c, v, { ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16), type, marketId: id, detail });
  }
  for (const l of Q[c]) {
    const type = NAME[l.topics[0]], v = l.address.toLowerCase();
    const d = l.data; const len = Number(w(d, 1)); const ids = []; for (let i = 0; i < len; i++) ids.push("0x" + d.slice(2 + 64 * (2 + i), 2 + 64 * (3 + i)));
    const ours = IDS[c].filter(id => ids.includes(id));
    push(c, v, { ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16), type, marketId: null, detail: { caller: addr(l.topics[1]), queueLength: len, affectedMarketsInQueue: ours } });
  }
  for (const l of PAALL[c].filter(l => l.topics[0] === T.SetFlowCaps)) {
    const v = addr(l.topics[2]); const d = l.data; const n = Number(w(d, 1)); const caps = [];
    for (let i = 0; i < n; i++) { const id = "0x" + d.slice(2 + 64 * (2 + 3 * i), 2 + 64 * (3 + 3 * i)); caps.push({ id, maxIn: w(d, 3 + 3 * i), maxOut: w(d, 4 + 3 * i) }); }
    const ours = caps.filter(x => IDS[c].includes(x.id));
    if (!ours.length) continue;
    for (const x of ours) push(c, v, { ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16), type: "PublicAllocator.SetFlowCaps", marketId: x.id, detail: { sender: addr(l.topics[1]), maxIn: r2(num(x.maxIn, 6)), maxOut: r2(num(x.maxOut, 6)) } });
  }
  for (const l of PAALL[c].filter(l => l.topics[0] === T.PublicReallocateTo && IDS[c].includes(l.topics[3]))) {
    push(c, addr(l.topics[2]), { ts: iso(parseInt(l.blockTimestamp, 16)), unix: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16), type: "PublicAllocator.PublicReallocateTo", marketId: l.topics[3], detail: { sender: addr(l.topics[1]), suppliedAssets: r2(num(w(l.data, 0), 6)) } });
  }
}

function isProtective(e, prevQueueHas) {
  if (e.type === "SetCap" && e.detail.cap === 0) return "SetCap to 0";
  if (e.type === "SubmitMarketRemoval") return "SubmitMarketRemoval";
  if (e.type === "ReallocateWithdraw" && !e.detail.viaPublicAllocator && e.detail.withdrawnAssets > 0) return "curator ReallocateWithdraw";
  if (e.type === "PublicAllocator.SetFlowCaps" && e.detail.maxIn === 0) return "Public Allocator flow cap maxIn set to 0";
  return null;
}

async function positionAssets(c, id, vault, block) {
  try {
    const r = await call(+c, "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", "0x93c52062" + id.slice(2) + vault.slice(2).padStart(64, "0"), block);
    const shares = BigInt("0x" + r.slice(2, 66));
    const ms = await call(+c, "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", "0x5c60e39a" + id.slice(2), block);
    const tsa = BigInt("0x" + ms.slice(2, 66)), tss = BigInt("0x" + ms.slice(66, 130));
    return tss === 0n ? 0 : Number(shares * tsa / tss);
  } catch (e) { return null; }
}

for (const key of Object.keys(vaultEvents)) {
  const [c, v] = key.split(":");
  const evs = vaultEvents[key].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const info = VAPI[key];
  const touched = [...new Set(evs.map(e => e.marketId).filter(Boolean))].filter(id => IDS[c].includes(id));
  // queue events: mark a protective action when an exposed market disappears from the supply queue
  const prevSupplyQ = {};
  const exposed = [];
  for (const id of touched) {
    const mm = marketMeta[c + ":" + id]; if (!mm) continue;
    const div = mm.mk.divergence;
    let first = null;
    let qHas = null;
    for (const e of evs) {
      if (e.type === "SetSupplyQueue") { const has = e.detail.affectedMarketsInQueue.includes(id); if (qHas === true && !has && (!div || e.unix >= div.unix)) { if (!first) first = { ...e, action: "SetSupplyQueue removed market" }; } qHas = has; continue; }
      if (e.marketId !== id) continue;
      if (div && e.unix < div.unix) continue;
      const p = isProtective(e); if (p && !first) first = { ...e, action: p };
    }
    // exposure: vault supply in market before incident, at divergence, at first action, end of window
    const ld = mm.ld;
    const pre = mm.mk.timeline.find(r => r.unix >= 1774137600);
    const end = mm.mk.timeline.at(-1);
    const supPre = pre ? await positionAssets(c, id, v, pre.block) : null;
    const supDiv = div ? await positionAssets(c, id, v, div.block) : null;
    const supEnd = end ? await positionAssets(c, id, v, end.block) : null;
    const rowDiv = div ? mm.at(div.unix) : null;
    const paIntoVault = evs.filter(e => e.type === "PublicAllocator.PublicReallocateTo" && e.marketId === id && div && e.unix >= div.unix);
    const silentEnd = first ? first.unix : (end ? end.unix : null);
    const paDuringSilence = paIntoVault.filter(e => e.unix < silentEnd);
    // withdrawable during silence: max liquidity seen between divergence and first protective action
    let maxLiq = null;
    if (div) for (const r of mm.mk.timeline) if (r.unix >= div.unix && r.unix <= silentEnd && (maxLiq == null || r.withdrawable > maxLiq.withdrawable)) maxLiq = r;
    exposed.push({
      marketId: id, collateral: mm.mk.collateral.symbol, loan: mm.mk.loan.symbol,
      vaultSupplyPreIncident: supPre == null ? null : r2(supPre / 10 ** ld),
      vaultSupplyAtDivergence: supDiv == null ? null : r2(supDiv / 10 ** ld),
      vaultSupplyEndOfWindow: supEnd == null ? null : r2(supEnd / 10 ** ld),
      marketWithdrawableAtDivergence: rowDiv ? rowDiv.withdrawable : null,
      marketWithdrawableAtDivergenceSampleTs: rowDiv ? rowDiv.ts : null,
      firstProtectiveAction: first ? { ts: first.ts, block: first.block, tx: first.tx, type: first.type, action: first.action, detail: first.detail } : null,
      minutesFromDivergence: first && div ? Math.round((first.unix - div.unix) / 60) : null,
      maxMarketWithdrawableDuringSilence: maxLiq ? { ts: maxLiq.ts, withdrawable: maxLiq.withdrawable, utilization: maxLiq.utilization } : null,
      publicAllocatorInflowToMarketForThisVaultAfterDivergence: r2(paIntoVault.reduce((s, e) => s + e.detail.suppliedAssets, 0)),
      publicAllocatorInflowBeforeFirstAction: r2(paDuringSilence.reduce((s, e) => s + e.detail.suppliedAssets, 0)),
      publicAllocatorTxBeforeFirstAction: paDuringSilence.length,
    });
  }
  const firsts = exposed.filter(x => x.firstProtectiveAction).sort((a, b) => a.firstProtectiveAction.ts.localeCompare(b.firstProtectiveAction.ts));
  out.vaults.push({
    chain: c === "1" ? "ethereum" : "base", chainId: +c, address: v,
    name: info?.name || null, curator: info?.curatorNames?.join(", ") || null, curatorAddress: info?.curatorAddr || null,
    exposedMarkets: exposed,
    curatorEvents: evs.map(({ unix, logIndex, ...e }) => e),
    firstProtectiveActionTs: firsts[0]?.firstProtectiveAction.ts || null,
    minutesFromDivergence: firsts[0]?.minutesFromDivergence ?? null,
    withdrawableAtDivergence: exposed.reduce((s, x) => s + (x.marketWithdrawableAtDivergence || 0), 0) || null,
  });
}
out.vaults.sort((a, b) => (b.exposedMarkets.reduce((s, x) => s + (x.publicAllocatorInflowToMarketForThisVaultAfterDivergence || 0) + (x.vaultSupplyEndOfWindow || 0), 0)) - (a.exposedMarkets.reduce((s, x) => s + (x.publicAllocatorInflowToMarketForThisVaultAfterDivergence || 0) + (x.vaultSupplyEndOfWindow || 0), 0)));
// strip helper fields
for (const m of out.markets) { for (const r of m.timeline) delete r.unix; for (const e of m.drainEvents) delete e.unix; if (m.divergence) delete m.divergence.unix; }
fs.writeFileSync(D + "resolv-2026-03-22.json", JSON.stringify(out, null, 1));
console.log("markets", out.markets.length, "vaults", out.vaults.length);
for (const m of out.markets) console.log(m.chain, m.marketId.slice(0, 10), m.collateral.symbol + "/" + m.loan.symbol, "div", m.divergence?.ts, m.divergence?.marketPrice, "full", m.fullUtilizationAfterDivergence?.ts, JSON.stringify(m.stats));
for (const v of out.vaults) for (const x of v.exposedMarkets) console.log(v.chain, v.name, "|", v.curator, "|", x.collateral + "/" + x.loan, x.marketId.slice(0, 10), "pre", x.vaultSupplyPreIncident, "div", x.vaultSupplyAtDivergence, "end", x.vaultSupplyEndOfWindow, "act", x.firstProtectiveAction?.ts, x.firstProtectiveAction?.action, "min", x.minutesFromDivergence, "PAin", x.publicAllocatorInflowToMarketForThisVaultAfterDivergence, "PAbefore", x.publicAllocatorInflowBeforeFirstAction, "maxLiq", JSON.stringify(x.maxMarketWithdrawableDuringSilence));
