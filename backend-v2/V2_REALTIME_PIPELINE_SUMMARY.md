# V2 Realtime Pipeline - Implementation Summary

## Overview

This PR implements a complete, buildable, and runnable v2 realtime pipeline for the Base-only Aave V3 liquidation bot. This is a clean replacement for PR #188 with zero placeholders and correct pricing implementation.

## Key Components Implemented

### 1. Pricing Layer (prices/)
- **priceMath.ts**: Core pricing module with 1e18 BigInt normalization
  - Chainlink decimals cache and feed management
  - Ratio feed composition support (*_ETH × ETH_USD for WSTETH, WEETH, etc.)
  - Pyth integration with expo application and staleness checks
  - Zero floating point math - all calculations in BigInt
  - `getUsdPrice(symbol)` returns 1e18-scaled BigInt values only

### 2. Realtime Triggers (realtime/)
- **dirtyQueue.ts**: Set-based queue for marking users that need HF verification
  - `markDirty(address)`: Mark user as needing check
  - `takeBatch(max)`: Pop up to N dirty users for processing
  - `size()`: Get current queue size
  
- **aavePoolListeners.ts**: Subscribe to Aave Pool events
  - Borrow, Repay, Supply, Withdraw events
  - Only marks users in active risk set as dirty
  - Efficient event-driven architecture

### 3. Risk Verification (risk/)
- **verifierLoop.ts**: Bounded batch HF verification loop
  - 250ms interval (configurable)
  - Processes up to 200 users per tick (configurable)
  - Triggers execution when HF <= HF_THRESHOLD_EXECUTE and debt >= MIN_DEBT_USD
  
- **pairSelector.ts**: Collateral/debt pair selection
  - Supports env overrides (COLLATERAL_ASSET, DEBT_ASSET)
  - Optional Aave UI Pool Data Provider integration
  - Selects largest collateral and debt by value

### 4. Execution (execution/)
- **executorClient.ts**: Executor contract client with EXACT ABI from old bot
  ```solidity
  function initiateLiquidation((
    address user,
    address collateralAsset,
    address debtAsset,
    uint256 debtToCover,
    bytes oneInchCalldata,
    uint256 minOut,
    address payout
  ) params) external
  ```
  - Uses EIP-1559 transactions
  - Waits for confirmation and reports status
  
- **oneInch.ts**: 1inch swap calldata builder
  - Supports both v6 (with API key) and v5 (public fallback)
  - Returns calldata, minOut, to, value
  
- **attemptHistory.ts**: Per-user attempt logging
  - Statuses: sent, reverted, included, error, skip_no_pair
  - Keeps last 10 attempts per user

### 5. Liquidation Audit (audit/)
- **liquidationAudit.ts**: Subscribe to LiquidationCall events
  - Classifies missed liquidations:
    1. not_in_active_set
    2. debt_below_min
    3. hf_never_crossed
    4. tx_reverted_or_not_included
  - Sends Telegram notifications with:
    - User address, collateral asset, debt asset
    - Liquidator address and tx hash
    - Classified reason
    - Last HF and debt USD

### 6. Main Integration (index.ts)
- Seeds borrower universe from subgraph
- Builds active risk set with on-chain HF checks
- Initializes price oracles (Chainlink + Pyth)
- Sets up dirty queue and Aave Pool listeners
- Starts verifier loop with execution callback
- Starts liquidation audit listener
- Graceful shutdown on SIGINT/SIGTERM

## Configuration

### Required Environment Variables
```bash
# RPC endpoints
RPC_URL=https://mainnet.base.org
WS_RPC_URL=wss://mainnet.base.org

# Subgraph
SUBGRAPH_URL=https://gateway.thegraph.com/api/[key]/subgraphs/id/[id]

# Aave V3 Pool
AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5

# Risk thresholds
MIN_DEBT_USD=50.0
HF_THRESHOLD_START=1.05
HF_THRESHOLD_EXECUTE=1.0

# Executor
EXECUTOR_ADDRESS=0x...
EXECUTION_PRIVATE_KEY=0x...

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

### Optional Environment Variables
```bash
# 1inch API (for v6 endpoint)
ONEINCH_API_KEY=

# Chainlink feeds override
CHAINLINK_FEEDS_JSON={"WETH":"0x...","USDC":"0x..."}

# Pyth feeds
PYTH_FEED_IDS_JSON={"WETH":"0x...","USDC":"0x..."}

# Pair selection
AAVE_UI_POOL_DATA_PROVIDER=0x...
COLLATERAL_ASSET=0x...
DEBT_ASSET=0x...
```

## Build and Run

### Build
```bash
cd backend-v2
npm install
npm run build
```

### TypeCheck
```bash
npm run typecheck
```

### Run
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

## Verification

✅ **Zero placeholders** - All files are complete and compilable  
✅ **TypeScript compiles cleanly** - `tsc --noEmit` passes  
✅ **Build succeeds** - `npm run build` produces dist/  
✅ **Exact ABI match** - Executor call matches old bot's ExecutionService.ts  
✅ **Correct pricing** - 1e18 BigInt scaling with no floating point  
✅ **Bounded verifier** - Processes max 200 users per 250ms tick  
✅ **Complete audit** - LiquidationCall events with classification  

## Next Steps

To make the bot fully operational:

1. **Configure .env** - Set all required environment variables
2. **Deploy executor contract** - Or use existing EXECUTOR_ADDRESS
3. **Configure Chainlink feeds** - Set CHAINLINK_FEEDS_JSON with Base feed addresses
4. **Configure Pyth feeds** - Set PYTH_FEED_IDS_JSON with Pyth feed IDs
5. **Test execution** - Verify transactions are sent correctly
6. **Monitor audit** - Check Telegram for liquidation audit messages

## Architecture Notes

- **Event-driven**: Aave Pool events trigger dirty queue marks
- **Bounded processing**: Verifier loop prevents RPC overload
- **Separation of concerns**: Clear module boundaries
- **Type-safe**: Full TypeScript with strict checking
- **No feature creep**: Minimal viable implementation per spec
