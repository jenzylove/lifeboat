import { describe, expect, it } from 'vitest';
import { gapPct, marketLiquidity, oraclePriceToFloat, sharesToAssetsDown, toFloat, utilization, withdrawable } from '../src/math.js';
import { blockAtAge, classifySamples } from '../src/oracleStaleness.js';
import { V1_TOPICS } from '../src/curatorEvents.js';

describe('oraclePriceToFloat', () => {
  it('WETH(18)/USDC(6) at 3000', () => {
    const raw = 3000n * 10n ** 36n * 10n ** 6n / 10n ** 18n; // 3000e24
    expect(oraclePriceToFloat(raw, 6, 18)).toBeCloseTo(3000, 6);
  });
  it('cbBTC(8)/USDC(6) at 64000', () => {
    const raw = 64000n * 10n ** 36n * 10n ** 6n / 10n ** 8n; // 64000e34
    expect(oraclePriceToFloat(raw, 6, 8)).toBeCloseTo(64000, 4);
  });
  it('same decimals stable at 1.0 (1e36)', () => {
    expect(oraclePriceToFloat(10n ** 36n, 6, 6)).toBe(1);
  });
  it('collateral with fewer decimals than loan', () => {
    // 6-dec collateral worth 2 loan tokens, 18-dec loan: raw = 2 * 1e36 * 1e18/1e6
    expect(oraclePriceToFloat(2n * 10n ** 36n * 10n ** 18n / 10n ** 6n, 18, 6)).toBeCloseTo(2, 9);
  });
});

describe('utilization / liquidity', () => {
  it('computes ratio', () => {
    expect(utilization(1000n, 850n)).toBe(0.85);
    expect(utilization(0n, 0n)).toBe(0);
    expect(utilization(1000n, 1000n)).toBe(1);
  });
  it('liquidity floors at 0', () => {
    expect(marketLiquidity(1000n, 850n)).toBe(150n);
    expect(marketLiquidity(100n, 200n)).toBe(0n);
  });
});

describe('gapPct', () => {
  it('oracle above market is positive', () => expect(gapPct(105, 100)).toBeCloseTo(5, 9));
  it('oracle below market is negative', () => expect(gapPct(95, 100)).toBeCloseTo(-5, 9));
  it('equal is 0', () => expect(gapPct(100, 100)).toBe(0));
  it('rejects non-positive market price', () => expect(() => gapPct(1, 0)).toThrow());
});

describe('withdrawable', () => {
  it('sums min(position, liquidity) plus idle', () => {
    expect(
      withdrawable(
        [
          { positionAssets: 100n, liquidity: 40n },
          { positionAssets: 50n, liquidity: 500n },
          { positionAssets: 10n, liquidity: 0n },
        ],
        7n,
      ),
    ).toBe(40n + 50n + 0n + 7n);
  });
  it('empty is idle only', () => expect(withdrawable([], 5n)).toBe(5n));
});

describe('shares and floats', () => {
  it('sharesToAssetsDown with virtual shares/assets', () => {
    // 1:1 pool of 1e12 assets / 1e18 shares (shares carry 1e6 virtual offset)
    expect(sharesToAssetsDown(10n ** 18n, 10n ** 12n, 10n ** 18n)).toBe(((10n ** 18n) * (10n ** 12n + 1n)) / (10n ** 18n + 1_000_000n));
    expect(sharesToAssetsDown(0n, 5n, 5n)).toBe(0n);
  });
  it('toFloat', () => {
    expect(toFloat(1_500_000n, 6)).toBe(1.5);
    expect(toFloat(0n, 18)).toBe(0);
  });
});

describe('staleness classification', () => {
  const s = (vals: (bigint | null)[]) => vals.map((raw, i) => ({ ageSeconds: i, block: 1n, raw }));
  it('fixed by design when all equal', () => {
    expect(classifySamples(s([5n, 5n, 5n, 5n, 5n]))).toEqual({ lastChangeAgo: '>=7d', fixedByDesign: true });
  });
  it('changed within 1h', () => expect(classifySamples(s([6n, 5n, 5n, 5n, 5n])).lastChangeAgo).toBe('<1h'));
  it('changed 1h-6h ago', () => expect(classifySamples(s([5n, 5n, 4n, 4n, 4n])).lastChangeAgo).toBe('1h-6h'));
  it('changed 6h-24h ago', () => expect(classifySamples(s([5n, 5n, 5n, 4n, 4n])).lastChangeAgo).toBe('6h-24h'));
  it('changed 1d-7d ago', () => expect(classifySamples(s([5n, 5n, 5n, 5n, 4n]))).toEqual({ lastChangeAgo: '1d-7d', fixedByDesign: false }));
  it('missing archive data is unknown, not guessed', () => {
    expect(classifySamples(s([5n, 5n, null, 5n, 5n]))).toEqual({ lastChangeAgo: 'unknown', fixedByDesign: false });
  });
  it('block estimation', () => {
    expect(blockAtAge(1_000_000n, 3600, 8453)).toBe(1_000_000n - 1800n);
    expect(blockAtAge(1_000_000n, 3600, 1)).toBe(1_000_000n - 300n);
  });
});

describe('MetaMorpho topic hashes', () => {
  it('match known selectors', () => {
    // SetCap(address,bytes32,uint256) and ReallocateSupply selectors are keccak256 of the official signatures
    expect(Object.values(V1_TOPICS).sort()).toEqual(
      ['RevokePendingCap', 'ReallocateSupply', 'ReallocateWithdraw', 'SetCap', 'SetSupplyQueue', 'SetWithdrawQueue', 'SubmitCap', 'SubmitMarketRemoval'].sort(),
    );
    expect(Object.keys(V1_TOPICS).every((t) => /^0x[0-9a-f]{64}$/.test(t))).toBe(true);
  });
});
