import { sweep, buildSweepMessage } from '../src/decide/sweep.js';
const now = Date.parse('2026-03-22T02:40:00Z') / 1000;
const breaks = [
  { marketId: '0xd9e34b1e', collateralSymbol: 'wstUSR', collateralName: 'Wrapped stUSR', collateralAddress: '0x1202F5C7b4B9E47a1A484E8B270be34dbbC75055', gapPct: 2500, since: now - 600, where: 'Morpho ethereum' },
  { marketId: '0x8e7cc042', collateralSymbol: 'USR', collateralName: 'Resolv USD', collateralAddress: '0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110', gapPct: 2500, since: now - 600, where: 'Morpho ethereum' },
];
const guarded = [
  { marketId: '0xe1b65304', collateralSymbol: 'RLP', collateralName: 'Resolv Liquidity Provider Token', collateralAddress: '0x4956b52aE2fF65D74CA2d61207523288e4528f96', vaultName: 'Resolv USDC', exposureUsd: 900000 },
  { marketId: '0xcbbtc000', collateralSymbol: 'cbBTC', collateralName: 'Coinbase Wrapped BTC', collateralAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', vaultName: 'Gauntlet USDC Prime', exposureUsd: 3e8 },
  { marketId: '0xusde0000', collateralSymbol: 'sUSDe', collateralName: 'Staked USDe', collateralAddress: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', vaultName: 'Steakhouse USDC', exposureUsd: 5e7 },
];
console.log(buildSweepMessage(guarded, breaks, now));
const r = await sweep(guarded, breaks, now);
console.log(JSON.stringify({ flags: r.flags, error: r.error, raw: r.raw?.slice(0, 600), model: r.model?.model }, null, 1));
