# Lifeboat PRD

## One liner
Your USDC earns yield in a Morpho vault. If a market in that vault keeps an old price while the real market crashes, Lifeboat watches the people running your vault. If they act, you stay and keep earning. If they go quiet, your money gets off the boat and parks in a safer vault.

## Problem (sourced, numbers verified in data/replay)
- Mar 22 2026, Resolv USR: a compromised key minted about 80M unbacked USR. Morpho markets kept pricing wstUSR near $1.13 while it traded far lower. About 15 curated vaults were exposed. Lenders whose curators were slow ended up lending USDC against collateral worth a fraction of its price.
- Nov 2025, Stream xUSD: oracle near $1.26 while xUSD traded near $0.26. Markets went to full utilization and lenders could not withdraw.
- Morpho's withdraw path has no price check, so an exit works while the feed is frozen, limited only by liquidity. Minutes matter: once borrowers drain the market, lenders are stuck.
- A lender today has two choices: trust the curator blindly, or watch every market of every vault around the clock.

## User
Anyone holding USDC in a Morpho vault on Base, from $1 to large size. Front door: the live board of Base USDC vaults, each market with its feed clock and the curator's last move.

## How it works (who decides)
1. Person: creates a Lifeboat account (one tx), approves the vaults it may use, deposits USDC. Owner can withdraw anytime; agent cannot send money anywhere but approved vaults or the account. (Contract enforces.)
2. Code, every minute: per market in the vault, oracle price vs market price, how long the oracle has not moved, utilization, withdrawable liquidity, collateral supply changes, and the curator's onchain actions (cap changes, reallocations, removals).
3. Code opens the clock when a market's oracle and market price diverge past the threshold for several reads.
4. Dolphin model (DeepSeek V4.1 Flash, open weights) makes the stay or leave call every cycle while the clock runs. It reads the whole evidence pack: market data history, curator actions, collateral mint and burn activity, public posts from the curator, the protocol forum and the collateral issuer. It returns STAY, WAIT (minutes), or LEAVE, with reasons tied to evidence ids, and which approved vault to re park in.
5. Code clamps: the model can only choose among approved vaults; hard rules override it (if the gap is above the hard limit and the curator has been silent past the hard window, leave regardless; if the curator capped the market to zero and reallocated away, stay). If the model is down, the rule decides.
6. Code executes move(from, to) from the keeper, with the decision hash onchain, and publishes the full decision record.
7. SERV Reasoning writes the plain words notice to the user and the curator report card from the decision record and onchain history.

## Why Dolphin (Dolphin track)
- The core act is a personalized decision to pull and reallocate one person's money between named investment products. Anthropic's Usage Policy (effective Nov 12 2026) classes that as a high risk recommendation that a qualified person must review before it is acted on. An unattended agent cannot run it on Claude as built. Open weights served by Dolphin carry no such rule.
- Cost: reading the full evidence pack for every market of every watched vault every minute is cheap on Dolphin ($0.01 per million input tokens). Measured cost per watched vault per day is published on the proof page.
- Honest: Dolphin currently serves from its own hardware with a zero retention fallback; we say "open model, different stack", not "fully decentralized".

## Judge's first minute
1. Open the site: live board of Base USDC Morpho vaults, every market with its feed clock, price gap and the curator's last onchain move. No login.
2. Paste any Morpho vault address: the same, live.
3. Replay Mar 22: the real oracle and market prices, utilization and curator transactions from that day, with Dolphin's decisions computed on the evidence available at each moment. Shows the minute Lifeboat would have left, how much was still withdrawable then, and when each curator actually moved.
4. Fire drill on the public house boat: a real Lifeboat account on Base with real USDC; the keeper runs a real exit and re park; two Basescan links.
5. Optional: connect a wallet with Base USDC and arm your own account with $1.

## Claims and proof
| Claim | Proof |
|---|---|
| The agent can never take your money | Contract source, 9 fork tests on Base mainnet, verified on Basescan |
| Exit works while the feed is frozen | Morpho withdraw path has no oracle check; fire drill tx on mainnet |
| Lifeboat would have left at minute M on Mar 22 with $Y still withdrawable | data/replay with block numbers and tx hashes |
| Curator response times | onchain event timestamps, linked |
| Every decision is published | decision records with hashes matching the Exited event |
| Cost per vault per day | measured token counts times Dolphin price |

## Revenue
10% of yield earned while armed, taken only on owner withdrawal (v1 shows it, does not charge). Curator report card API for allocators and vault rating sites.

## What it does not do
- It cannot get out of a market already at 100% utilization; the replay shows honestly what was withdrawable when.
- Base only for live accounts; replay data from Ethereum mainnet where the incident happened.
- It does not judge curator strategy in calm times; it acts only on a frozen feed plus curator silence.

## Sponsor checklist (OpenServ SERV Edition 02)
- [ ] SERV Reasoning used in the build (notice and report card writer)
- [ ] Dolphin track: agent built on an open model via Dolphin (decision maker)
- [ ] Public repo
- [ ] Demo link or video
- [ ] Short write up: what it does, how it uses SERV Reasoning, which track
- [ ] X post
- [ ] Typeform submission (logo, data collection answer)
