<p align="center">
  <img src="docs/media/brand/mark.svg" width="76" alt="Lifeboat" />
</p>

<h1 align="center">Lifeboat</h1>

<p align="center"><b>Your USDC gets off before the vault sinks.</b><br>
An open model on Dolphin watches the people running your Morpho vault, and moves your money out when a price feed freezes and they go quiet.</p>

<p align="center">
  <a href="https://lifeboat.jdollar.site"><img alt="Live" src="https://img.shields.io/badge/live-lifeboat.jdollar.site-FF4F00?style=flat-square"></a>
  <a href="https://basescan.org/address/0x22cC997126756D77a4f7BDb687867BCF3D54644b"><img alt="House boat on Base" src="https://img.shields.io/badge/house%20boat-Base%20mainnet-0B1A26?style=flat-square"></a>
  <a href="https://github.com/jenzylove/lifeboat/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jenzylove/lifeboat/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Built for SERV Hackathon 02" src="https://img.shields.io/badge/built%20for-SERV%20Hackathon%2002%20·%20Dolphin-07121B?style=flat-square">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-EAF2EF?style=flat-square"></a>
  <a href="https://x.com/dollar782"><img alt="X" src="https://img.shields.io/badge/X-@dollar782-000000?style=flat-square"></a>
</p>

![Lifeboat](docs/media/hero.png)

## Start here

| | |
|---|---|
| Live app | [lifeboat.jdollar.site](https://lifeboat.jdollar.site) |
| Demo video (3:28) | [youtu.be/yB8HLn_9xTU](https://youtu.be/yB8HLn_9xTU) |
| Try it on your own vault | open any vault from the [board](https://lifeboat.jdollar.site/#board) or paste an address, then press **Ask Lifeboat now** |
| Watch the March 22 replay | [lifeboat.jdollar.site/replay](https://lifeboat.jdollar.site/replay) |
| Press a real fire drill | [the house boat](https://lifeboat.jdollar.site/#house) |
| Arm your own with $1 | [lifeboat.jdollar.site/app](https://lifeboat.jdollar.site/app) |
| Every decision, published | [lifeboat.jdollar.site/proof](https://lifeboat.jdollar.site/proof) |
| Evidence | [`data/replay`](data/replay) (incident data read onchain), [`data/launch.json`](data/launch.json) (mainnet launch) |

## Why this matters

Your USDC earns yield in a Morpho vault. Every vault lends into markets that trust a price feed for their collateral. When that feed keeps an old price while the real market crashes, borrowers post the broken token at the stale price and drain the lenders. The people running your vault, its curators, can stop it by cutting the market.

On March 22 2026 a compromised key minted about 80 million unbacked Resolv USR. Morpho markets kept pricing wstUSR at **$1.1330** for the whole incident while it traded at a fraction of that. In one market that had **$4,053** borrowed, borrowers pulled **$6,244,125** in 133 transactions and it was fully borrowed **42 minutes** after the price broke. Across the five affected markets, **$10.8M** of vault money was still stuck two days later. One curator got its vault out in 23 minutes; another took 30 hours.

**Replayed through the live code on Dolphin, a $1,000 depositor in each of the 10 exposed vaults is out by 02:59 UTC, 33 minutes after the first break, with the money actually withdrawable at that moment.** In the seven RLP positions Lifeboat moves before RLP's own price feed shows anything.

![The March 22 replay](docs/media/replay.png)

## How it works

```mermaid
flowchart LR
  A[Every minute: each market in your vault<br/>oracle price vs real price, share borrowed,<br/>curator moves, token supply] --> B{Clock opens?}
  B -- gap holds 2 min --> C[Price clock]
  B -- market pinned near fully borrowed --> D[Liquidity clock]
  S[Sweep: Dolphin reads every guarded market<br/>next to every live break] -- same issuer, wrapped or tranche token --> E[Related clock]
  C & D & E --> F[Dolphin model decides<br/>STAY, WAIT or LEAVE<br/>citing evidence ids]
  F --> G[Code clamps it<br/>approved vaults only, hard rules win]
  G -- LEAVE --> H[Keeper calls the account contract<br/>money moves to your other approved vault,<br/>or back into your account]
  H --> I[SERV Reasoning writes your notice<br/>from the real transaction]
```

| Step | Who decides |
|---|---|
| Reading prices, utilization, curator events, token supply | Code, onchain and public sources |
| Opening a clock | Code (gap held for two minutes, or a market pinned near fully borrowed) |
| Linking a calm market to a break elsewhere | Dolphin model (the sweep). A price feed cannot see this. |
| Stay, wait or leave, and where to park | Dolphin model, every reason tied to an evidence id |
| Final say | Code. Hard rules override the model: a 25% gap with 30 minutes of curator silence, a market 95% borrowed, a model down for 10 minutes. An unreadable curator history never counts as silence. |
| Moving money | The account contract. The agent can only move USDC between vaults you approved, or into your account. If the destination refuses the deposit, it exits into your account instead. |
| Taking money out | Only you, any time, no notice |

**The sweep** is the part a rule cannot do. On March 22 the price feed for RLP, Resolv's liquidity provider token, showed no gap until 03:39 UTC, but its sister tokens USR and wstUSR had been collapsing since 02:27. The sweep reads every market Lifeboat guards next to every live break and links tokens by issuer, wrapping or tranche. In the replay it linked RLP to USR at 02:40.

**Ask Lifeboat now** runs the same decision on demand: open any Morpho vault, press the button, and in about 20 seconds Dolphin reads it live and says STAY, WAIT or LEAVE with its reasons and evidence, explained in plain words by SERV. No transaction is sent; every check is published on `/proof`.

## Why only on Dolphin

The core act is a personalized decision to pull one person's money out of one named investment product and put it in another, unattended, every minute. [Anthropic's Usage Policy](https://www.anthropic.com/legal/aup) treats that as a high risk recommendation that a qualified person must review before it is acted on. Lifeboat runs the decision on **DeepSeek V4.1 Flash, open weights served by Dolphin**, over a standard API, so the model can move to any node that serves the same weights. It is also nearly free: the whole March 22 replay, 10 decisions and the sweeps, cost **$0.001** on Dolphin, recorded per call in [`data/replay/decisions.json`](data/replay/decisions.json).

## Where SERV Reasoning is used

SERV Reasoning writes the notice a person reads after every action Lifeboat takes (live moves, fire drills, the replay) and the explanation for every on demand check. Code writes the first sentence from the transaction itself (what moved, from where, to where, with the Basescan link), so a model can never misstate where your money went. SERV explains why, from the decision's own reasons. Every notice records the model that wrote it.

## Live on Base mainnet

| What | Address or transaction |
|---|---|
| Factory | [`0xdeb5BDF6BADaFBdE806a86B385CFf14d05dCeaDE`](https://basescan.org/address/0xdeb5BDF6BADaFBdE806a86B385CFf14d05dCeaDE) |
| Account implementation | [`0x35810276c5937ADA331F50986aB27a23A14AC237`](https://basescan.org/address/0x35810276c5937ADA331F50986aB27a23A14AC237) |
| House boat (public demo account) | [`0x22cC997126756D77a4f7BDb687867BCF3D54644b`](https://basescan.org/address/0x22cC997126756D77a4f7BDb687867BCF3D54644b) |
| Keeper (the agent's signer) | [`0xF336572d3efE34dab09730449dC53ca294c94e03`](https://basescan.org/address/0xF336572d3efE34dab09730449dC53ca294c94e03) |
| Default approved vaults | Steakhouse USDC [`0xbeeF…8183`](https://basescan.org/address/0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183), Gauntlet USDC Prime [`0xeE8F…4b61`](https://basescan.org/address/0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61) |
| A fire drill from the demo video | [`0x891c…af2e`](https://basescan.org/tx/0x891c9c4e8a65c61bf16f8da7d6ea0f1690d0a481d203b983729fe1cb5d28af2e) |
| A wallet arming its own Lifeboat in the video | [create](https://basescan.org/tx/0x82545a37142593655e77cb1a007ac8ca37e6d46235ab7ef0fb5525430542cacf), [send $1](https://basescan.org/tx/0xd5665d3917ebbfeef739656975c00bf2964c59b0344b9edf67e8e6d1a8040672), [park](https://basescan.org/tx/0x80197a77bb45e06d8957bc4c69d8e98f463e93b509d1bc64372a8521e38fe74b) |

The watcher runs every minute on the live server and guards the house boat and every account created through the factory. Launch transactions are recorded in [`data/launch.json`](data/launch.json).

## Claims you can check

| Claim | Check it |
|---|---|
| The agent can never take your money | [`LifeboatAccount.sol`](contracts/src/LifeboatAccount.sol): the keeper can only `deposit` into an approved vault, `exit` to the account, or `move` between them. 9 fork tests against Base mainnet in [`contracts/test`](contracts/test). |
| Hard rules beat the model | [`policy.ts`](engine/src/decide/policy.ts) `clamp()`, 48 tests in [`policy.test.ts`](engine/src/decide/policy.test.ts) and [`engine/test`](engine/test) |
| The model cannot invent evidence | `validateModel()` rejects any reason citing an evidence id that is not in the pack |
| A failed read is never treated as curator silence | `curatorUnknown` in [`policy.ts`](engine/src/decide/policy.ts) and [`watcher.ts`](engine/src/watcher.ts) |
| Getting out never depends on parking | `keeperMove()` in [`keeper.ts`](engine/src/keeper.ts) falls back to `exit` |
| Every decision is published | `/api/decisions` and [`/proof`](https://lifeboat.jdollar.site/proof): evidence, model, tokens, cost, hash, transaction |
| Replay numbers are real | [`data/replay`](data/replay): every sample has its block and source |

## Run it yourself

```bash
# contracts (Foundry), fork tests against Base mainnet
cd contracts && forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && forge test

# engine: decision policy, sweep, watcher, keeper
cd engine && npm ci && npx vitest run

# replay March 22 through the live code (needs DOLPHIN_API_KEY, optional SERV_API_KEY)
cd engine && npx tsx scripts/replay.ts

# app + watcher
cd app && npm ci && npm run build && cd .. && node scripts/serve.mjs
```

Environment: `DOLPHIN_API_KEY`, `SERV_API_KEY`, `KEEPER_PK` (server only), `FACTORY`, `FACTORY_BLOCK`, `HOUSE_ACCOUNT`, `APPROVED_VAULTS`, `DATA_DIR`, `BASE_RPC_URL`.

## Repo map

| Path | What |
|---|---|
| [`contracts/`](contracts) | `LifeboatAccount` (one per user) and `LifeboatFactory` |
| [`engine/src/decide/`](engine/src/decide) | clocks, evidence pack, Dolphin call with one repair turn, clamp, sweep, notices |
| [`engine/src/watcher.ts`](engine/src/watcher.ts) | the minute loop that reads, decides and moves |
| [`engine/src/assess.ts`](engine/src/assess.ts) | Ask Lifeboat now: the same decision on demand, no transaction |
| [`engine/src/keeper.ts`](engine/src/keeper.ts) | the signer, with a cross process lock and the exit fallback |
| [`engine/scripts/replay.ts`](engine/scripts/replay.ts) | replays real incidents through the live code |
| [`app/`](app) | Next.js app: board, vault pages, replay, house boat, arm your own, proof |
| [`data/replay/`](data/replay) | Resolv (Mar 22 2026) and Stream (Nov 2025) incidents, read onchain, and the scripts that built them in [`scripts/replay`](scripts/replay) |

## Business

Planned fee: 10% of the yield earned while armed, taken when you withdraw. Not charged during the hackathon. A lender who would have lost a deposit in one of these incidents pays for years of it in a single save. The curator response record Lifeboat builds as a side effect, how fast each curator really acts, is a product of its own for allocators.

## Scope

Live accounts are on Base, with USDC, across Morpho vaults the owner approves. Replays use Ethereum, Base and Arbitrum mainnet data at 10 minute samples; the live watcher reads every minute. Lifeboat cannot pull money out of a market that is already fully borrowed; the replay shows exactly what was withdrawable when. See [SECURITY.md](SECURITY.md) for what the agent can and cannot do.

## License

MIT
