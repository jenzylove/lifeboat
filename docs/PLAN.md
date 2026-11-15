# Lifeboat plan (deadline Nov 15 2026 23:59 UTC)

| # | Phase | Done when | Owner |
|---|---|---|---|
| 1 | Contracts | 9 fork tests pass on Base (DONE 02:50 UTC) | main |
| 2 | Live data layer | snapshot of a real Base vault with every field sourced | sonnet agent |
| 3 | Replay data, Mar 22 | json with oracle, market price, utilization, curator txs by block | opus agent |
| 4 | Decision engine | Dolphin returns valid STAY/WAIT/LEAVE on live and replay packs; clamp tests pass | main |
| 5 | Mainnet | factory deployed and verified on Base; house boat armed; fire drill tx | main (needs funded keeper) |
| 6 | Watcher | runs every minute on a host, writes snapshots and decisions | main |
| 7 | App | board, vault page, replay, fire drill, arm with wallet, proof page | opus agent |
| 8 | SERV | notice and curator report card written through SERV Reasoning | main |
| 9 | Audit | release readiness audit findings fixed | agent + main |
| 10 | Launch | README, demo video, X post, form text | main |

## Risks
- Dolphin key and credit: needs the user (coupon). Known.
- Public RPC archive limits for replay: needs a spike (agent running).
- Live curator posts: X has no free API; use Morpho forum, curator blogs, issuer status pages that are public. Needs a spike.
- Host for the minute watcher: Railway or similar. Known.
