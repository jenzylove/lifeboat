# Replay datasets

Two incidents where a Morpho market oracle kept pricing collateral at par while the collateral traded far lower. All values come from onchain reads at historical blocks, Morpho's API, or DefiLlama, and each price row names its source. Nothing here is estimated unless marked.

| File | Incident | Window (UTC) |
|---|---|---|
| `resolv-2026-03-22.json` | Resolv USR unbacked mint | 2026-03-21 12:00 to 2026-03-24 00:00 |
| `stream-2025-11-04.json` | Stream Finance xUSD collapse | 2025-10-09 00:00 to 2025-11-08 00:00 |

Files starting with `_` are the raw pulls the builders read (logs, block samples, API responses). Rebuild with the scripts in `scripts/replay/` (order: `discover`, `logs`, `pa_all`, `queues`, `vaultinfo`, `timeline`, `curvefine`, `fixnull`, `build`; Stream: `stream_logs`, `stream`, `fixnull_stream`, `stream`).

## How it was read

* Markets: Morpho API (`markets` filtered by collateral address for USR, wstUSR and RLP on Ethereum, Base and Arbitrum), then `market(id)` on Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` (same address on Ethereum and Base, verified by successful reads; Arbitrum is `0x6c247b1F6182318877311737BaC0844bAa518F5e`) at several blocks to find the markets that actually moved. Five Resolv markets moved; the other 28 stayed under about $25K.
* Timeline: one sample every 10 minutes (361 per market). Each row is `market(id)` plus the oracle's `price()` at the same block. RPC: `mainnet.gateway.tenderly.co`, `base.gateway.tenderly.co`, `arbitrum.gateway.tenderly.co` (public archive endpoints; publicnode and Ankr now require keys for archive reads).
* Secondary price:
  * USR: Curve USR/USDC pool `0x3eE841F47947FEFbE510366E4bbb49e145484195`, `get_dy(USR to USDC, 1000 USR)` at the same block.
  * wstUSR: that USR quote times `wstUSR.convertToAssets(1e18)` (1.13297 USR per wstUSR throughout) at the same block.
  * RLP: DefiLlama coins chart, nearest point within 30 minutes. This series is sparse and noisy (92 of 361 rows have no point, and it printed above the oracle at 02:29). Treat RLP divergence times as approximate.
  * Base USR market: the Ethereum Curve quote nearest in time (cross chain reference).
  * xUSD: DefiLlama coins chart (1h and 10m series merged).
* Events: `eth_getLogs` on Morpho Blue (topic = market id), every MetaMorpho vault event with the market id as topic (SetCap, SubmitCap, RevokePendingCap, ReallocateSupply, ReallocateWithdraw, SubmitMarketRemoval), SetSupplyQueue / SetWithdrawQueue for every vault found, and the Public Allocator (`0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D` Ethereum, `0xA090dD1a701408Df1d4d0B85b716c87565f90467` Base): PublicReallocateTo, PublicWithdrawal, SetFlowCaps.
* Vault positions: `position(id, vault)` converted with the market's share price, at the pre incident sample, at divergence, and at the end of the window.

## Definitions used in the JSON

* `divergence`: first sample where (oracle minus market) / oracle exceeds 5%. For USR and wstUSR it uses a one minute Curve series (`_curve_fine.json`).
* `incident.incidentDivergence`: the USR divergence on Ethereum, **2026-03-22 02:27:23 UTC** (block 24710060, 1000 USR quoted at 940.46 USDC; the first sub par print was 02:26:23 at 954.58). All `minutesFromIncidentDivergence` values count from here.
* `firstProtectiveAction`: first event after incident divergence that cuts exposure on that market: SetCap to 0, SubmitMarketRemoval, a ReallocateWithdraw sent by an allocator that is not the Public Allocator, a supply queue that drops the market, or a Public Allocator flow cap with maxIn 0. Caution: some vaults run hourly rebalancing bots, so an early ReallocateWithdraw can be routine (Resolv USDC at 02:33 is one).
* `inflowStopAction`: first SetCap 0, flow cap maxIn 0, or market removal. This is the action that actually stopped new vault money going in.
* `thirdPartySupplyOnBehalfOfVaultAfterDivergence`: USDC supplied into the market with `onBehalf = vault` by an address that is not the vault. Caps do not block this path.

## Resolv headline numbers

* Oracle on the wstUSR/USDC market (`0xd9e34b1e...`, oracle `0xDa850a72...`, LLTV 91.5%) read **1.1330** at every sample from Mar 21 12:00 to Mar 24 00:00. The oracle multiplies a fixed $1 USR feed (`0xf9C7c25F...`, "USR Price AggregatorV3 interface") by the wstUSR exchange rate. The USR markets read 1.0000 and the RLP markets 1.2872 the whole time.
* Curve priced USR at 0.940 at 02:27, 0.070 at 02:38, 0.048 at 02:40, then bounced between about 0.4 and 1.0 for hours as the thin pool was refilled. Curve implied wstUSR was 0.776 at 03:00, 0.630 at 06:00 and 0.480 at 12:00.
* wstUSR/USDC market: $4,926 supplied and $4,053 borrowed at 00:10. First drain borrow at **02:40:23, 13 minutes after divergence**. Utilization hit 100% at 03:09:59. **$6,244,125 borrowed in 133 borrow transactions** after divergence; $6,233,519 owed at Mar 24 00:00.
* Public Allocator moved **$5,502,050** into wstUSR/USDC in 55 transactions. The first came at 02:40:23 in the same transaction as the first drain borrow, 90% had landed by 03:00:59, and the last came at 04:52:35. Of that, $5,071,049 came from Gauntlet USDC Core.
* **Gauntlet USDC Core** held $5,070 in wstUSR/USDC at divergence. Its curator's first move was a $335K ReallocateWithdraw at 02:52:11 (25 minutes), but the Public Allocator kept refilling. The flow cap went to maxIn 0 at **03:16:35 (49 minutes)** and the cap to 0 at 03:59:35 (92 minutes). The vault still held **$4,958,838** there at Mar 24 00:00.
* **Resolv USDC (Gauntlet), RLP/USDC**: about $676K supplied. The market had **$283,939 withdrawable at divergence**, $225K at 02:39, $239K at 02:59, $162K at 03:29 and $184K at 03:39, then 0 from 03:49 onward. The vault's first inflow stop came at 04:01:11 (94 minutes), after the liquidity was gone, and **$676,509 was still there at the end**.
* **Re7 USDC (Base), USR/USDC**: $11,694 supplied. The market had **$6,123 withdrawable (52% of the position) for 40 minutes**, from 02:27 until the first drain borrow at 03:07:37. Re7 set the cap to 0 at 03:00:43 (33 minutes) but did not withdraw. Third parties then supplied **$416,730 on behalf of the vault** between 10:49 and 11:28, leaving $428,438 at the end.
* **Smokehouse USDC (Steakhouse), USR/USDC**: $10,121 at divergence. ReallocateWithdraw at 02:50:47 (23 minutes) and **0 left at the end**. This was the only exposed position fully exited.
* **Clearstar Yield USDC** supplied **$999,996 into RLP/USDC between 03:37 and 05:50**, after the USR depeg, and set the cap to 0 at 06:50:35 (263 minutes). $1,000,645 was there at the end.
* Base USR/USDC: $11,697 supplied and $5,574 borrowed before the incident, then **$1,252,367 borrowed** after divergence. The Public Allocator moved $538,918 in (03:10 to 04:30, mostly from the Seamless USDC Vault). A further $877K arrived through third party supply on behalf of Re7 USDC, Extrafi XLend and Seamless.
* Totals across the five markets: $9.38M borrowed after divergence. Exposed vault positions summed to **$10.84M at Mar 24 00:00**. **16 vaults** ended the window with more than $10K in these markets (21 had any exposure, 33 emitted config events).
* Liquidations: 2 (Ethereum USR) and 5 (Base USR), all small, with no bad debt realized in the window. The losses stay as unrealized positions against collateral the oracle still prices at par.

## Stream xUSD headline numbers

* Market: Arbitrum xUSD/USDC `0x9e90aec7...`, oracle `0x1837efFC...`, LLTV 91.5%. The oracle read 1.2539 on Oct 9 and drifted to 1.2665 by Nov 8; it never moved down.
* Divergence: **2025-11-03 11:39:57 UTC** (DefiLlama 1.1848 vs oracle 1.2661). xUSD then printed 0.3674 at Nov 4 12:00, 0.2397 at Nov 4 20:00 and 0.0925 at Nov 8.
* The market emptied **before** the price moved. Supply was $26.19M with $23.09M borrowed on Oct 27, then $2.46M on Oct 31 and $0.75M on Nov 1. Withdrawable liquidity was last above $100K at Nov 1 07:00 ($964K) and last above $10K at Nov 2 20:00 ($43.8K). From Nov 2 23:00 the market sat at 100% utilization, so **withdrawable at divergence was $0**.
* **MEV Capital USDC** withdrew $16.91M gross through ReallocateWithdraw and supplied back $2.51M between Oct 28 and Nov 2 (about $14.4M net) (largest single moves $2.0M, $1.9M and $1.9M). It still held $1,632,611 on Nov 1, **$627,417 at divergence** and **$634,243 at Nov 8**. Cap to 0 came at Nov 6 13:40:49, 74 hours after divergence.
* Other residual positions at Nov 8: Not Gauntlet $37,004 and Vaultik USDC $1,245.
* Takeaway for Lifeboat: in Stream an oracle gap trigger fires about 13 hours after the market was already locked at 100% utilization. The usable signals were the supply exodus and utilization pinned near 100% from Oct 28.

## Gaps

* Arbitrum Resolv markets (RLP/USDC about $22.8K, wstUSR markets under $10) were not sampled. The free Arbitrum endpoints failed archive reads at the time of the first pass.
* There is no onchain wstUSR or RLP pool deep enough to quote. The wstUSR price is derived from Curve USR times the exchange rate, and RLP comes from DefiLlama. The Curve pool was thin and swung hard (0.04 to 1.0 within 20 minutes), so a 10 minute sample can land on either extreme.
* The Base USR market uses the Ethereum Curve quote.
* Vault curator names come from the Morpho API. Where the API had none, a Gauntlet or Steakhouse label is inferred from the curator address that sent the SetCap and is marked "inferred".
* Elixir deUSD and sdeUSD markets (exposed to Stream through deUSD backing) are not included. Only xUSD collateral was replayed.
* Vault share price, depositor withdrawals and vault level liquidity (as opposed to market level withdrawable) are not in this dataset.
