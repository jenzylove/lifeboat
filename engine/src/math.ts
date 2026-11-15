/** Pure math, no I/O. Unit tested. */

const VIRTUAL_SHARES = 1_000_000n; // Morpho Blue SharesMathLib: 1e6
const VIRTUAL_ASSETS = 1n;

/**
 * Morpho oracle price() is the price of 1 unit (base unit) of collateral quoted in base units of the loan
 * token, scaled by 1e36:
 *   raw = (collateralBaseUnit -> loanBaseUnits) * 1e36
 * Human price (loan tokens per 1 whole collateral token) is therefore
 *   raw / 1e36 * 10^(collateralDecimals - loanDecimals)
 * e.g. WETH(18)/USDC(6): raw ~ 3000 * 1e36 * 1e6 / 1e18 = 3000e24 ; human = 3000e24/1e36 * 1e12 = 3000.
 */
export function oraclePriceToFloat(raw: bigint, loanDecimals: number, collateralDecimals: number): number {
  if (raw < 0n) throw new Error('negative oracle price');
  return Number(raw) * 10 ** (collateralDecimals - loanDecimals - 36);
}

/** utilization = borrow / supply, 0 when no supply. */
export function utilization(totalSupplyAssets: bigint, totalBorrowAssets: bigint): number {
  if (totalSupplyAssets === 0n) return 0;
  return Number((totalBorrowAssets * 1_000_000n) / totalSupplyAssets) / 1_000_000;
}

/** Instantly withdrawable liquidity in a Morpho Blue market = supply - borrow (floored at 0). */
export function marketLiquidity(totalSupplyAssets: bigint, totalBorrowAssets: bigint): bigint {
  return totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n;
}

/** Morpho SharesMathLib.toAssetsDown */
export function sharesToAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

/**
 * Gap (%) between oracle price and market price, both in loan units per collateral token:
 *   (oracle - market) / market * 100
 * Positive = oracle values the collateral ABOVE the market (the dangerous direction for lenders:
 * borrowers can borrow more than the collateral is worth on the open market). Negative = oracle below market.
 */
export function gapPct(oraclePrice: number, marketPrice: number): number {
  if (!(marketPrice > 0)) throw new Error('market price must be > 0');
  return ((oraclePrice - marketPrice) / marketPrice) * 100;
}

/**
 * What a vault can pull out right now, in loan base units: for each market, min(vault position, market liquidity),
 * summed. Idle (idle-market position or raw vault balance) is fully withdrawable and passed separately.
 */
export function withdrawable(positions: { positionAssets: bigint; liquidity: bigint }[], idle: bigint = 0n): bigint {
  let sum = idle;
  for (const p of positions) sum += p.positionAssets < p.liquidity ? p.positionAssets : p.liquidity;
  return sum;
}

/** base units -> float tokens */
export function toFloat(amount: bigint, decimals: number): number {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const whole = a / 10n ** BigInt(decimals);
  const frac = a % 10n ** BigInt(decimals);
  const v = Number(whole) + Number(frac) / 10 ** decimals;
  return neg ? -v : v;
}
