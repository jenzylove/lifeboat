# Lifeboat contracts

`LifeboatAccount` is one account per user. The owner approves ERC4626 USDC vaults; the keeper (the Lifeboat agent) can only deposit idle USDC into an approved vault, exit a vault back into the account, or move between them. Only the owner can withdraw, sweep tokens, change the approved list or pause the keeper.

`LifeboatFactory` deploys accounts as minimal clones with the owner as `msg.sender`, so nobody can create an account for someone else.

```bash
forge test   # 9 fork tests against Base mainnet USDC and Morpho vaults
```

Deployed on Base: factory `0xdeb5BDF6BADaFBdE806a86B385CFf14d05dCeaDE`, implementation `0x35810276c5937ADA331F50986aB27a23A14AC237`.
