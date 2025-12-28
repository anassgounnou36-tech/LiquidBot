# Hardhat Fork Test Implementation Summary

## Overview
This implementation adds comprehensive Hardhat fork support for testing LiquidBot against a local Base mainnet fork with seeded near-threshold Aave v3 positions. This enables safe, reproducible testing of predictive and price-trigger features without mainnet execution.

## Files Added

### 1. Root Configuration
- **`hardhat.config.ts`** (792 bytes)
  - Base mainnet fork configuration (chainId 8453)
  - Reads `HARDHAT_FORK_URL` and optional `HARDHAT_FORK_BLOCK` from `.env`
  - Auto-mining enabled with zero interval
  - No contract compilation required

- **`tsconfig.json`** (232 bytes)
  - TypeScript configuration for root-level Hardhat support
  - ES2022 target with CommonJS modules
  - Enables strict mode and JSON resolution

### 2. Fork Setup Script
- **`backend/scripts/fork/setup-scenario.ts`** (6.8 KB)
  - Seeds near-threshold Aave v3 borrower positions
  - Six-step process:
    1. Wrap ETH → WETH via `deposit()`
    2. Approve and supply WETH as collateral to Aave v3 Pool
    3. Query Aave Oracle prices (1e8) and liquidation threshold (bps)
    4. Compute USDC borrow amount for target HF (~1.02)
    5. Execute initial borrow with variable rate
    6. Optional second borrow to tighten HF further (~1.005-1.01)
  - Human-friendly progress logging
  - Configurable via environment variables

- **`backend/scripts/fork/README.md`** (1.3 KB)
  - Documentation for fork scripts directory
  - Environment variable reference
  - Usage instructions

### 3. Documentation
- **`docs/fork-test-hardhat.md`** (6.1 KB)
  - Comprehensive testing guide
  - Prerequisites and environment setup
  - Step-by-step workflow
  - Monitoring and validation instructions
  - Advanced testing scenarios
  - Troubleshooting section

### 4. Package Configuration
- **`package.json`** (updated)
  - Added `hardhat:node` script: `hardhat node`
  - Added `fork:setup` script: `ts-node backend/scripts/fork/setup-scenario.ts`
  - Added devDependencies:
    - `hardhat@^2.22.2`
    - `@nomicfoundation/hardhat-toolbox@^4.0.0`
    - `ethers@^6.10.0`
    - `typescript@^5.6.3`
    - `ts-node@^10.9.2`
    - `dotenv@^16.4.5`

## Environment Variables

### Required for Fork Testing
- `HARDHAT_FORK_URL`: Base mainnet RPC URL (e.g., Alchemy)
- `FORK_TEST_PK`: Private key for test account (Hardhat default accounts recommended)
- `RPC_URL`: Local Hardhat node URL (default: http://127.0.0.1:8545)

### Optional Customization
- `HARDHAT_FORK_BLOCK`: Pin to specific block for reproducibility
- `FORK_TEST_ETH_DEPOSIT`: ETH amount to wrap into WETH (default: 1.0)
- `FORK_TEST_TARGET_HF_BPS`: Initial HF target in basis points (default: 10200 = 1.02)
- `FORK_TEST_SECOND_BORROW_BPS`: Second borrow HF target for tighter testing (e.g., 10080 = 1.008)

### Bot Configuration for Fork Testing
- `RPC_URL=http://127.0.0.1:8545`
- `WS_RPC_URL=ws://127.0.0.1:8545`
- `CHAINLINK_RPC_URL=http://127.0.0.1:8545`
- `BACKFILL_RPC_URL=http://127.0.0.1:8545`
- `USE_FLASHBLOCKS=false`
- `EXECUTE=false`
- `PYTH_ENABLED=true` (Pyth WS still connects to live Hermes)
- `PRICE_TRIGGER_ENABLED=true`
- `PREDICTIVE_ENABLED=true`

## Usage Workflow

1. **Start Hardhat Fork Node**
   ```bash
   npm run hardhat:node
   ```

2. **Seed Test Position**
   ```bash
   npm run fork:setup
   ```

3. **Run Bot Against Fork**
   ```bash
   cd backend && npm run dev
   ```

4. **Monitor Metrics**
   ```bash
   curl http://localhost:3000/metrics
   ```

## Key Metrics to Monitor
- `liquidbot_realtime_min_health_factor`: Should show HF ~1.005-1.02
- `liquidbot_realtime_price_triggers_total{asset="WETH"}`: Price trigger activations
- `liquidbot_predictive_ticks_executed_total`: Predictive evaluation count
- `liquidbot_predictive_micro_verify_scheduled_total`: Micro-verification calls

## Design Principles

### Minimal Changes
- **Zero runtime code changes**: All additions are dev-only scripts and configuration
- **No new required env vars**: Only optional testing knobs added
- **Consistent with existing patterns**: Uses same ethers v6 and dotenv versions as backend

### Safety First
- **Execution disabled by default**: `EXECUTE=false` prevents mainnet transactions
- **Flashblocks disabled**: `USE_FLASHBLOCKS=false` reduces fork complexity
- **Local-only RPCs**: All bot RPCs point to `127.0.0.1:8545`

### Developer Experience
- **Clear documentation**: Comprehensive guide with examples and troubleshooting
- **Human-friendly logging**: Setup script provides clear progress updates
- **Configurable scenarios**: Environment variables allow testing different HF thresholds
- **Reproducible**: Optional block pinning via `HARDHAT_FORK_BLOCK`

## Testing Capabilities

### Predictive Path Testing
- Bot can evaluate predictive projections against near-threshold positions
- Pyth WebSocket provides early-warning price updates
- Chainlink serves as oracle-of-record for validation

### Price-Trigger Testing
- Seed positions at HF ~1.02, then observe price-trigger scans
- All reads/writes hit local fork for fast, safe iteration
- Can simulate price movements by manipulating fork state

### Event-Driven Testing
- Real-time event listeners detect fork state changes
- Backfill discovers seeded positions on startup
- Hotlist tracking monitors near-threshold accounts

## Technical Details

### Contract Addresses (Base Mainnet)
- WETH: `0x4200000000000000000000000000000000000006`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Aave Pool: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- Aave Oracle: `0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156`
- Protocol Data Provider: `0xC4Fcf9893072d61Cc2899C0054877Cb752587981`

### Computation Logic
Health Factor calculation:
```
HF = (collateral_value_usd × liquidationThreshold_bps) / (debt_value_usd × 10000)
```

Borrow amount computation (targeting specific HF):
```typescript
collateral_usd = (weth_amount × weth_price_1e8) / 1e18
target_debt_usd = (collateral_usd × liquidation_threshold_bps) / target_hf_bps
usdc_amount = (target_debt_usd × 1e6) / usdc_price_1e8
```

Safety margin: Final borrow is 99% of computed amount to ensure HF > 1.0

## Validation

### Linting
- Script passes ESLint with backend's configuration
- No TypeScript compilation errors

### Compatibility
- Ethers v6: ✓ (matches backend@6.13.0)
- Dotenv: ✓ (uses backend's 16.4.5)
- TypeScript: ✓ (compatible with backend's 5.5.4)
- ts-node: ✓ (matches backend@10.9.2)

## Future Enhancements (Optional)

1. **Multiple Asset Support**: Extend script to test with cbBTC, WBTC, etc.
2. **Position Variations**: Add script variants for different collateral/debt pairs
3. **Automated Price Manipulation**: Helper scripts to modify Chainlink feed prices
4. **Multi-User Scenarios**: Batch script to create multiple at-risk positions
5. **Liquidation Simulation**: Script to trigger actual liquidations on fork

## Limitations

### Network Restrictions
- Cannot download Solidity compiler due to network blocks
- Fork requires external RPC URL (Alchemy, Infura, etc.)
- Pyth WebSocket connects to live Hermes (not forked)

### Fork Behavior
- State resets on each Hardhat restart
- Gas costs are zero (not realistic)
- Block timestamps may differ from mainnet
- No mempool competition

## Conclusion

This implementation provides a complete, safe, and developer-friendly environment for testing LiquidBot's advanced features against realistic near-threshold positions on a local Base fork. All requirements from the problem statement have been met with zero runtime code changes.
