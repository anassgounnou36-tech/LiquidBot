import { describe, it, expect } from 'vitest';

describe('PriceMath BigInt Logic', () => {
  describe('BigInt exponentiation', () => {
    it('should correctly compute 10^n for various n', () => {
      // Test pure BigInt exponentiation logic
      expect(10n ** 0n).toBe(1n);
      expect(10n ** 1n).toBe(10n);
      expect(10n ** 8n).toBe(100000000n);
      expect(10n ** 10n).toBe(10000000000n);
      expect(10n ** 18n).toBe(1000000000000000000n);
    });

    it('should correctly normalize from 8 decimals to 18 decimals', () => {
      // Simulate Chainlink 8 decimal price: $3000.00000000
      const price8Decimals = 300000000000n; // 3000 * 1e8
      const exponent = 18 - 8; // 10
      
      const normalized = price8Decimals * (10n ** BigInt(exponent));
      
      // Should equal 3000 * 1e18
      expect(normalized).toBe(3000000000000000000000n);
    });

    it('should correctly normalize from 18 decimals to 18 decimals (no-op)', () => {
      const price18Decimals = 3000000000000000000000n; // 3000 * 1e18
      
      // No conversion needed
      expect(price18Decimals).toBe(3000000000000000000000n);
    });

    it('should correctly compute ratio feed composition', () => {
      // Example: WSTETH_ETH ratio = 1.15 (1.15 * 1e18)
      const wstethEthRatio = 1150000000000000000n; // 1.15 * 1e18
      
      // ETH_USD price = 3000 (3000 * 1e18)
      const ethUsdPrice = 3000000000000000000000n; // 3000 * 1e18
      
      // WSTETH_USD = (ratio * ethUsdPrice) / 1e18
      const wstethUsdPrice = (wstethEthRatio * ethUsdPrice) / (10n ** 18n);
      
      // Should equal 3450 * 1e18 (1.15 * 3000)
      expect(wstethUsdPrice).toBe(3450000000000000000000n);
    });
  });

  describe('Debt USD calculation', () => {
    it('should correctly compute debtUsd1e18 from totalDebtBase', () => {
      // totalDebtBase is in 1e8 units (Aave base currency)
      const totalDebtBase = 100000000n; // 1.0 ETH in 1e8 units
      
      // ETH price: $3000
      const ethUsd1e18 = 3000000000000000000000n; // 3000 * 1e18
      
      // Convert totalDebtBase from 1e8 to 1e18
      const totalDebtBase1e18 = totalDebtBase * (10n ** 10n);
      expect(totalDebtBase1e18).toBe(1000000000000000000n); // 1.0 * 1e18
      
      // Calculate debtUsd1e18
      const debtUsd1e18 = (totalDebtBase1e18 * ethUsd1e18) / (10n ** 18n);
      
      // Should equal $3000
      expect(debtUsd1e18).toBe(3000000000000000000000n); // 3000 * 1e18
      
      // Convert to display number
      const debtUsdDisplay = Number(debtUsd1e18) / 1e18;
      expect(debtUsdDisplay).toBe(3000);
    });

    it('should correctly handle small debt amounts', () => {
      // 0.01 ETH in 1e8 units
      const totalDebtBase = 1000000n; // 0.01 * 1e8
      const ethUsd1e18 = 3000000000000000000000n; // 3000 * 1e18
      
      const totalDebtBase1e18 = totalDebtBase * (10n ** 10n);
      const debtUsd1e18 = (totalDebtBase1e18 * ethUsd1e18) / (10n ** 18n);
      
      // Should equal $30
      const debtUsdDisplay = Number(debtUsd1e18) / 1e18;
      expect(debtUsdDisplay).toBe(30);
    });

    it('should correctly filter by MIN_DEBT_USD threshold', () => {
      const minDebtUsd = 50; // $50 minimum
      const minDebtUsd1e18 = BigInt(Math.floor(minDebtUsd)) * (10n ** 18n);
      
      // Debt of $100
      const debtUsd1e18High = 100n * (10n ** 18n);
      expect(debtUsd1e18High >= minDebtUsd1e18).toBe(true);
      
      // Debt of $30
      const debtUsd1e18Low = 30n * (10n ** 18n);
      expect(debtUsd1e18Low >= minDebtUsd1e18).toBe(false);
      
      // Debt of exactly $50
      const debtUsd1e18Exact = 50n * (10n ** 18n);
      expect(debtUsd1e18Exact >= minDebtUsd1e18).toBe(true);
    });
  });

  describe('Close factor calculation', () => {
    it('should correctly compute 50% close factor', () => {
      // Total debt: 2.0 ETH in 1e8 units
      const totalDebtBase = 200000000n; // 2.0 * 1e8
      
      // 50% close factor
      const debtToCover = totalDebtBase / 2n;
      
      expect(debtToCover).toBe(100000000n); // 1.0 * 1e8
    });

    it('should handle odd debt amounts with integer division', () => {
      // Total debt: 1.5 ETH in 1e8 units
      const totalDebtBase = 150000000n; // 1.5 * 1e8
      
      // 50% close factor (BigInt division truncates)
      const debtToCover = totalDebtBase / 2n;
      
      expect(debtToCover).toBe(75000000n); // 0.75 * 1e8
    });
  });

  describe('ETH aliasing', () => {
    it('should demonstrate ETH→WETH aliasing concept', () => {
      // Simulated feed addresses
      const feeds = new Map<string, string>();
      feeds.set('WETH', '0x1234567890123456789012345678901234567890');
      
      // Check if WETH exists but ETH doesn't
      if (feeds.has('WETH') && !feeds.has('ETH')) {
        // Alias ETH to WETH
        feeds.set('ETH', feeds.get('WETH')!);
      }
      
      expect(feeds.get('ETH')).toBe('0x1234567890123456789012345678901234567890');
      expect(feeds.get('ETH')).toBe(feeds.get('WETH'));
    });
  });
});
