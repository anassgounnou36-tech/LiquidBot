# V2 Production-Grade Liquidation Bot Implementation

## Overview
This implementation makes backend-v2 fully production-grade and competitive on Base-only Aave V3 by implementing exact, address-first oracle normalization and removing all hardcoded decimal assumptions.

## Implementation Details

### 1. Chainlink Listener Correctness & Speed

#### Changes Made
- **Dynamic Decimals Query**: Modified `ChainlinkListener.addFeed()` to query `decimals()` once per feed during initialization
- **Decimals Caching**: Added `decimalsCache: Map<string, number>` to cache decimals per feed address
- **1e18 Normalization**: Updated `handleLog()` to normalize all prices to 1e18 BigInt using cached decimals
- **Enhanced Logging**: Added detailed logging showing raw answer, decimals, and normalized value

#### Code Location
- File: `backend-v2/src/prices/ChainlinkListener.ts`
- Lines: 33-63 (addFeed), 126-174 (handleLog)

#### Algorithm
```typescript
// Normalization logic (pure BigInt math):
if (decimals === 18) {
  normalizedAnswer = rawAnswer;
} else if (decimals < 18) {
  const exponent = 18 - decimals;
  normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
} else {
  const exponent = decimals - 18;
  normalizedAnswer = rawAnswer / (10n ** BigInt(exponent));
}
```

### 2. Address-First Price System

#### Changes Made
- **New Config**: Added `CHAINLINK_FEEDS_BY_ADDRESS_JSON` to env schema
- **Address-to-Feed Mapping**: Added `addressToFeedMap` in priceMath.ts
- **Init Function**: Created `initChainlinkFeedsByAddress()` to populate mapping from config
- **Enhanced getUsdPriceForAddress()**: Updated to check address-to-feed mapping first before falling back to symbol lookup

#### Code Location
- Config: `backend-v2/src/config/env.ts` line 64
- PriceMath: `backend-v2/src/prices/priceMath.ts` lines 22-25, 56-70, 288-324

#### Usage
```json
// In .env file:
CHAINLINK_FEEDS_BY_ADDRESS_JSON={"0x4200000000000000000000000000000000000006":"0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"}
```

### 3. Removed Hardcoded Assumptions

#### Before
```typescript
// index.ts - REMOVED:
chainlinkListener.onPriceUpdate((update) => {
  const decimals = 8; // HARDCODED
  const exponent = 18 - decimals;
  const price1e18 = update.answer * (10n ** BigInt(exponent));
  updateCachedPrice(update.symbol, price1e18);
});
```

#### After
```typescript
// index.ts - Now uses normalized prices:
chainlinkListener.onPriceUpdate((update) => {
  updateCachedPrice(update.symbol, update.answer); // Already normalized
});
```

## Testing

### New Test Files
1. **chainlinkListener.test.ts**: 10 tests covering normalization logic
   - 8-decimal to 1e18 normalization
   - 18-decimal no-op
   - 6-decimal and 10-decimal normalization
   - 20-decimal downscaling
   - Deduplication logic
   - Decimals caching

2. **addressFirstPricing.test.ts**: 7 tests covering address-first pricing
   - Address-to-feed mapping
   - Multiple mappings
   - Case-insensitive handling
   - Prioritization over symbol lookup
   - Fallback behavior
   - Config parsing

### Test Results
```
✓ tests/addressFirstPricing.test.ts  (7 tests)
✓ tests/chainlinkListener.test.ts  (10 tests)
✓ tests/priceMath.test.ts  (10 tests)
✓ tests/config.test.ts  (2 tests)

Test Files  4 passed (4)
Tests  29 passed (29)
```

## Security & Quality Checks

### TypeScript Compilation
```bash
✓ tsc --noEmit (0 errors)
```

### ESLint
```bash
✓ eslint . --ext .ts (0 errors, 3 pre-existing warnings)
```

### CodeQL Security Scan
```bash
✓ CodeQL Analysis (0 alerts)
```

### Code Review
- 2 comments reviewed
- Both comments addressed or deemed acceptable
- No blocking issues

## Configuration

### New Environment Variables

#### CHAINLINK_FEEDS_BY_ADDRESS_JSON (Optional)
Enables address-first pricing without symbol() calls in execution path.

**Format**: JSON object mapping token address to feed address
```json
{
  "0x4200000000000000000000000000000000000006": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"
}
```

**Benefits**:
- Eliminates ERC20 symbol() calls during execution
- Faster price lookups (direct address → feed)
- More reliable (no dependency on token symbol() implementation)

## Backward Compatibility

### No Breaking Changes
- All existing functionality preserved
- Address-first pricing is **optional**
- Symbol-based pricing continues to work
- Existing configs continue to work

### API Changes
- `ChainlinkListener.addFeed()` now returns `Promise<void>` (was `void`)
- Callers must await: `await chainlinkListener.addFeed(symbol, address)`
- This change is already handled in index.ts

## Performance Improvements

### Reduced Runtime Queries
- **Before**: Query decimals on every price update (or assume 8)
- **After**: Query decimals once during initialization

### Faster Price Lookups
- **Before**: address → symbol (cache lookup) → feed (lookup) → price
- **After**: address → feed (direct lookup) → price

### Eliminated Assumptions
- **Before**: Hardcoded 8-decimal assumption in multiple places
- **After**: Uses actual decimals from each feed

## Production Readiness

### Non-Negotiable Requirements Met
- ✅ BigInt-only math, normalized to 1e18 for USD prices
- ✅ Chainlink OCR2 NewTransmission-only (already implemented)
- ✅ Address-first pricing (optional but implemented)
- ✅ No 8-decimal assumptions
- ✅ No symbol() in execution path (when address-first enabled)

### Deployment Checklist
1. Configure CHAINLINK_FEEDS_JSON with all required feeds
2. Optionally configure CHAINLINK_FEEDS_BY_ADDRESS_JSON for address-first pricing
3. Test with dry-run first (EXECUTION_ENABLED=false)
4. Monitor logs for decimals logging: `Added feed: WETH -> 0x... (decimals=8)`
5. Verify price updates show normalized values: `normalized=...000000000000000000 (1e18)`

## Future Enhancements

### Not Included in This PR
- Pyth integration (disabled, as per requirements)
- Ultra-fast deterministic planner
- Multi-RPC broadcast
- TX race strategy
- Metrics and validation scripts

These are out of scope for this PR but can be added in future iterations.

## Files Changed

1. `backend-v2/src/prices/ChainlinkListener.ts` - Dynamic decimals + normalization
2. `backend-v2/src/prices/priceMath.ts` - Address-first pricing support
3. `backend-v2/src/index.ts` - Removed hardcoded normalization
4. `backend-v2/src/config/env.ts` - Added CHAINLINK_FEEDS_BY_ADDRESS_JSON
5. `backend-v2/.env.example` - Documented new config
6. `backend-v2/tests/chainlinkListener.test.ts` - New test file
7. `backend-v2/tests/addressFirstPricing.test.ts` - New test file

## Verification

To verify the implementation works correctly:

```bash
# 1. Run tests
npm test

# 2. Type check
npm run typecheck

# 3. Lint
npm run lint

# 4. Build
npm run build
```

All commands should complete successfully with no errors.
