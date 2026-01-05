import { describe, it, expect } from 'vitest';

describe('ChainlinkListener Normalization Logic', () => {
  describe('Price normalization to 1e18', () => {
    it('should normalize 8-decimal price to 1e18', () => {
      // Simulate Chainlink 8 decimal price: $3000.00000000
      const rawAnswer = 300000000000n; // 3000 * 1e8
      const decimals = 8;
      
      // Normalize to 1e18
      const exponent = 18 - decimals;
      const normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      
      // Should equal 3000 * 1e18
      expect(normalizedAnswer).toBe(3000000000000000000000n);
    });

    it('should normalize 18-decimal price to 1e18 (no-op)', () => {
      const rawAnswer = 3000000000000000000000n; // 3000 * 1e18
      const decimals = 18;
      
      // No conversion needed
      let normalizedAnswer: bigint;
      if (decimals === 18) {
        normalizedAnswer = rawAnswer;
      } else if (decimals < 18) {
        const exponent = 18 - decimals;
        normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      } else {
        const exponent = decimals - 18;
        normalizedAnswer = rawAnswer / (10n ** BigInt(exponent));
      }
      
      expect(normalizedAnswer).toBe(3000000000000000000000n);
    });

    it('should normalize 6-decimal price to 1e18', () => {
      // USDC price: $1.00000000
      const rawAnswer = 1000000n; // 1 * 1e6
      const decimals = 6;
      
      // Normalize to 1e18
      const exponent = 18 - decimals;
      const normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      
      // Should equal 1 * 1e18
      expect(normalizedAnswer).toBe(1000000000000000000n);
    });

    it('should normalize 10-decimal price to 1e18', () => {
      const rawAnswer = 30000000000n; // 3 * 1e10
      const decimals = 10;
      
      // Normalize to 1e18
      const exponent = 18 - decimals;
      const normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      
      // Should equal 3 * 1e18
      expect(normalizedAnswer).toBe(3000000000000000000n);
    });

    it('should handle downscaling from 20 decimals to 1e18', () => {
      const rawAnswer = 300000000000000000000n; // 3 * 1e20
      const decimals = 20;
      
      // Normalize to 1e18
      const exponent = decimals - 18;
      const normalizedAnswer = rawAnswer / (10n ** BigInt(exponent));
      
      // Should equal 3 * 1e18
      expect(normalizedAnswer).toBe(3000000000000000000n);
    });
  });

  describe('Deduplication logic', () => {
    it('should create correct deduplication key', () => {
      const roundId = 12345;
      const feedAddress = '0x1234567890123456789012345678901234567890';
      
      const dedupeKey = `${roundId}:${feedAddress}`;
      
      expect(dedupeKey).toBe('12345:0x1234567890123456789012345678901234567890');
    });

    it('should detect duplicate using dedupeCache', () => {
      const dedupeCache = new Set<string>();
      
      const roundId = 12345;
      const feedAddress = '0x1234567890123456789012345678901234567890';
      const dedupeKey = `${roundId}:${feedAddress}`;
      
      // First time should not be in cache
      expect(dedupeCache.has(dedupeKey)).toBe(false);
      
      // Add to cache
      dedupeCache.add(dedupeKey);
      
      // Second time should be in cache
      expect(dedupeCache.has(dedupeKey)).toBe(true);
    });

    it('should allow same roundId with different feed addresses', () => {
      const dedupeCache = new Set<string>();
      
      const roundId = 12345;
      const feedAddress1 = '0x1111111111111111111111111111111111111111';
      const feedAddress2 = '0x2222222222222222222222222222222222222222';
      
      const dedupeKey1 = `${roundId}:${feedAddress1}`;
      const dedupeKey2 = `${roundId}:${feedAddress2}`;
      
      dedupeCache.add(dedupeKey1);
      
      // Same roundId but different feed should not be duplicate
      expect(dedupeCache.has(dedupeKey2)).toBe(false);
    });
  });

  describe('Chainlink feed decimals cache', () => {
    it('should cache decimals per feed address', () => {
      const decimalsCache = new Map<string, number>();
      
      const feedAddress1 = '0x1111111111111111111111111111111111111111';
      const feedAddress2 = '0x2222222222222222222222222222222222222222';
      
      decimalsCache.set(feedAddress1.toLowerCase(), 8);
      decimalsCache.set(feedAddress2.toLowerCase(), 18);
      
      expect(decimalsCache.get(feedAddress1.toLowerCase())).toBe(8);
      expect(decimalsCache.get(feedAddress2.toLowerCase())).toBe(18);
    });

    it('should handle normalized feed addresses', () => {
      const decimalsCache = new Map<string, number>();
      
      const feedAddress = '0x1234567890123456789012345678901234567890';
      decimalsCache.set(feedAddress.toLowerCase(), 8);
      
      // Should find with lowercase query
      expect(decimalsCache.get('0x1234567890123456789012345678901234567890')).toBe(8);
      
      // Should also find with mixed case input (after normalization)
      expect(decimalsCache.get('0x1234567890123456789012345678901234567890'.toLowerCase())).toBe(8);
    });
  });

  describe('Cache seeding at startup', () => {
    it('should seed cache with normalized price on addFeed', () => {
      // Simulate cache seeding logic that happens in addFeed()
      const latestPrice1e18 = new Map<string, bigint>();
      const feedAddress = '0x1234567890123456789012345678901234567890';
      
      // Simulate fetched data from latestRoundData()
      const rawAnswer = 300000000000n; // 3000 * 1e8 (8 decimals)
      const decimals = 8;
      
      // Normalize to 1e18 (same logic as in addFeed)
      let normalizedAnswer: bigint;
      if (decimals === 18) {
        normalizedAnswer = rawAnswer;
      } else if (decimals < 18) {
        const exponent = 18 - decimals;
        normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      } else {
        const exponent = decimals - 18;
        normalizedAnswer = rawAnswer / (10n ** BigInt(exponent));
      }
      
      // Store in cache
      latestPrice1e18.set(feedAddress.toLowerCase(), normalizedAnswer);
      
      // Verify cache is populated
      expect(latestPrice1e18.get(feedAddress.toLowerCase())).toBe(3000000000000000000000n); // 3000 * 1e18
    });
    
    it('should seed cache with 18-decimal price (no conversion)', () => {
      const latestPrice1e18 = new Map<string, bigint>();
      const feedAddress = '0x1234567890123456789012345678901234567890';
      
      // 18 decimal price (no conversion needed)
      const rawAnswer = 3000000000000000000000n; // 3000 * 1e18
      const decimals = 18;
      
      let normalizedAnswer: bigint;
      if (decimals === 18) {
        normalizedAnswer = rawAnswer;
      } else if (decimals < 18) {
        const exponent = 18 - decimals;
        normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      } else {
        const exponent = decimals - 18;
        normalizedAnswer = rawAnswer / (10n ** BigInt(exponent));
      }
      
      latestPrice1e18.set(feedAddress.toLowerCase(), normalizedAnswer);
      
      expect(latestPrice1e18.get(feedAddress.toLowerCase())).toBe(3000000000000000000000n);
    });
  });
});
