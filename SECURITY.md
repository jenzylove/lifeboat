# Security

Lifeboat moves real USDC on Base mainnet. This page says what the agent can and cannot do with your money, what we know can go wrong, and how to report a problem.

## What protects your money

| Guarantee | Where it is enforced |
|---|---|
| Only the owner can take money out of an account (`withdraw`, `ownerRedeemAll`, `sweep`) | `contracts/src/LifeboatAccount.sol`, `onlyOwner` |
| The keeper (the agent's signer) can only `deposit` idle USDC into a vault the owner approved, `exit` a vault back into the account, or `move` between the two | `onlyAgent` functions in the same file |
| No keeper call can send value to any address other than an approved vault or the account itself | Approvals go only to allowlisted ERC4626 vaults; redeems name the account as receiver |
| The owner can pause the keeper at any time, and exit even from a vault they later removed from the list | `setKeeperPaused`, `exit` works on any vault the account holds |
| Nobody can create or initialise an account for someone else | Clone salt is `msg.sender`; the implementation disables initialisers |
| The model can never move money on its own | Every decision passes through `clamp()` in `engine/src/decide/policy.ts`; hard rules win; only approved vaults are valid targets |

The contracts are covered by 9 fork tests against Base mainnet USDC and Morpho vaults (`contracts/test`). The decision policy is covered by 48 unit tests (`engine`).

## Known limits

- **One keeper per factory.** All accounts created by this factory share one keeper address, fixed at deploy. If its key leaked, it still could not take money out, but it could churn funds between a user's approved vaults until each owner pauses it. A per account keeper and a guardian pause are planned.
- **Fully borrowed markets.** No one can withdraw from a Morpho market that is 100% borrowed; Lifeboat included. The replay shows exactly what was withdrawable at each decision.
- **Destination refuses a deposit.** If the vault Lifeboat parks into refuses the deposit (for example its caps are full), the keeper falls back to an `exit` into the owner's account, so getting out never depends on parking.
- **Dust positions.** A position worth less than one unit of USDC can make a vault's redeem revert. The watcher and the fire drill skip dust.
- **Model output.** Model reasons must cite evidence ids that exist in the pack; anything else is rejected and the hard rules decide. Text from outside sources (forum titles) is cleaned and length capped before it reaches the model or an onchain reason string.
- **Secrets.** `KEEPER_PK`, `DOLPHIN_API_KEY` and `SERV_API_KEY` live only in the server environment. Errors returned by the API are cut to one line with URLs removed.

## Reporting

Please report anything that could put user funds at risk privately, by direct message to [@dollar782](https://x.com/dollar782) on X, or by a private GitHub security advisory on this repository. Include the contract or file, the steps, and the impact. Please do not open a public issue for a funds risk.
