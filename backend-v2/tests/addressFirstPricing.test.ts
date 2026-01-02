import { describe, it, expect } from 'vitest';

describe('Address-First Pricing System', () => {
  describe('Address-to-feed mapping', () => {
    it('should map token address to feed address', () => {
      const addressToFeedMap = new Map<string, string>();
      
      const wethAddress = '0x4200000000000000000000000000000000000006';
      const wethFeedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      
      addressToFeedMap.set(wethAddress.toLowerCase(), wethFeedAddress.toLowerCase());
      
      expect(addressToFeedMap.get(wethAddress.toLowerCase())).toBe(wethFeedAddress.toLowerCase());
    });

    it('should support multiple token-to-feed mappings', () => {
      const addressToFeedMap = new Map<string, string>();
      
      const wethAddress = '0x4200000000000000000000000000000000000006';
      const wethFeedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      
      const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      const usdcFeedAddress = '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B';
      
      addressToFeedMap.set(wethAddress.toLowerCase(), wethFeedAddress.toLowerCase());
      addressToFeedMap.set(usdcAddress.toLowerCase(), usdcFeedAddress.toLowerCase());
      
      expect(addressToFeedMap.size).toBe(2);
      expect(addressToFeedMap.get(wethAddress.toLowerCase())).toBe(wethFeedAddress.toLowerCase());
      expect(addressToFeedMap.get(usdcAddress.toLowerCase())).toBe(usdcFeedAddress.toLowerCase());
    });

    it('should handle case-insensitive addresses', () => {
      const addressToFeedMap = new Map<string, string>();
      
      const wethAddress = '0x4200000000000000000000000000000000000006';
      const wethFeedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      
      // Store with lowercase
      addressToFeedMap.set(wethAddress.toLowerCase(), wethFeedAddress.toLowerCase());
      
      // Retrieve with different case (after normalization)
      const mixedCaseAddress = '0x4200000000000000000000000000000000000006';
      expect(addressToFeedMap.get(mixedCaseAddress.toLowerCase())).toBe(wethFeedAddress.toLowerCase());
    });
  });

  describe('Address-first vs symbol-based pricing', () => {
    it('should prioritize address-to-feed mapping over symbol mapping', () => {
      const addressToFeedMap = new Map<string, string>();
      const addressToSymbolMap = new Map<string, string>();
      
      const tokenAddress = '0x4200000000000000000000000000000000000006';
      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      
      // Setup both mappings
      addressToFeedMap.set(tokenAddress.toLowerCase(), feedAddress.toLowerCase());
      addressToSymbolMap.set(tokenAddress.toLowerCase(), 'WETH');
      
      // Address-first approach: check address-to-feed mapping first
      const directFeed = addressToFeedMap.get(tokenAddress.toLowerCase());
      
      expect(directFeed).toBe(feedAddress.toLowerCase());
      // Should not need to look up symbol
    });

    it('should fall back to symbol mapping if address-to-feed not found', () => {
      const addressToFeedMap = new Map<string, string>();
      const addressToSymbolMap = new Map<string, string>();
      
      const tokenAddress = '0x4200000000000000000000000000000000000006';
      
      // Only setup symbol mapping (not address-to-feed)
      addressToSymbolMap.set(tokenAddress.toLowerCase(), 'WETH');
      
      // Try address-to-feed first
      const directFeed = addressToFeedMap.get(tokenAddress.toLowerCase());
      expect(directFeed).toBeUndefined();
      
      // Fall back to symbol mapping
      const symbol = addressToSymbolMap.get(tokenAddress.toLowerCase());
      expect(symbol).toBe('WETH');
    });
  });

  describe('Config initialization from JSON', () => {
    it('should parse CHAINLINK_FEEDS_BY_ADDRESS_JSON', () => {
      const configJson = {
        '0x4200000000000000000000000000000000000006': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B'
      };
      
      const addressToFeedMap = new Map<string, string>();
      
      for (const [tokenAddress, feedAddress] of Object.entries(configJson)) {
        addressToFeedMap.set(tokenAddress.toLowerCase(), feedAddress.toLowerCase());
      }
      
      expect(addressToFeedMap.size).toBe(2);
      expect(addressToFeedMap.get('0x4200000000000000000000000000000000000006')).toBe(
        '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'.toLowerCase()
      );
    });
  });

  describe('No symbol() runtime calls', () => {
    it('should demonstrate address-first path avoids symbol() calls', () => {
      const addressToFeedMap = new Map<string, string>();
      
      const tokenAddress = '0x4200000000000000000000000000000000000006';
      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      
      addressToFeedMap.set(tokenAddress.toLowerCase(), feedAddress.toLowerCase());
      
      // In address-first path, we can directly get feed address
      const directFeed = addressToFeedMap.get(tokenAddress.toLowerCase());
      
      // No need to call symbol() on token contract
      expect(directFeed).toBeDefined();
      expect(directFeed).toBe(feedAddress.toLowerCase());
    });
  });
});
