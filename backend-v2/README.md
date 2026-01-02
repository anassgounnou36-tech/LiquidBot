# LiquidBot Backend V2

**Status:** PR2 - Realtime Pipeline + Execution + Audit ✅

## Overview

Backend V2 is a clean-slate rebuild of the Aave V3 Base liquidation detection system. PR2 adds the complete realtime execution pipeline on top of PR1 foundation:

**PR1 Foundation:**
- **Universe Seeding**: Comprehensive borrower discovery from Aave V3 Base subgraph
- **Active Risk Set**: On-chain health factor checks using Multicall3
- **Oracle Integration**: 
  - Chainlink OCR2 (NewTransmission only - no AnswerUpdated)
  - Pyth Hermes WebSocket with staleness detection

**PR2 Realtime Pipeline:**
- **Dirty Queue**: In-memory queue for users needing HF rechecks
- **Event Listeners**: Aave Pool events (Borrow, Repay, Supply, Withdraw)
- **HF Verifier Loop**: 250ms loop with on-chain HF verification
- **Execution Path**: 1inch swap routing + flashloan executor
- **Attempt History**: Per-user liquidation attempt tracking
- **Liquidation Audit**: Event monitoring + miss classification + Telegram alerts

## Architecture

```
backend-v2/
├── src/
│   ├── config/         # Strict env validation (zod)
│   ├── providers/      # RPC/WS providers (Base)
│   ├── subgraph/       # Subgraph queries + universe seeding
│   ├── prices/         # Chainlink + Pyth listeners
│   ├── risk/           # ActiveRiskSet + HealthFactorChecker + Verifier Loop
│   ├── realtime/       # Dirty queue + Aave Pool event listeners
│   ├── execution/      # 1inch wrapper + executor client + attempt history
│   ├── audit/          # Liquidation audit + miss classification
│   ├── notify/         # Telegram notifications
│   └── index.ts        # Main entry point
```

## PR2 Components

### Realtime Pipeline
- **DirtyQueue** (`realtime/dirtyQueue.ts`): Set-based in-memory queue for users needing HF rechecks
- **Aave Pool Listeners** (`realtime/aavePoolListeners.ts`): Subscribe to Pool events, mark users dirty
- **HF Verifier Loop** (`risk/verifierLoop.ts`): 250ms tick, pop dirty batch, query HF, execute if liquidatable

### Execution Path
- **1inch Wrapper** (`execution/oneInch.ts`): Swap calldata generation (v6 with key, v5 fallback)
- **Executor Client** (`execution/executorClient.ts`): Submits EIP-1559 tx using exact ABI
- **Pair Selector** (`risk/pairSelector.ts`): Minimal collateral/debt pair selection (env-based)
- **Attempt History** (`execution/attemptHistory.ts`): Per-user attempt tracking (sent/error/skip)

### Audit & Monitoring
- **Liquidation Audit** (`audit/liquidationAudit.ts`): Listen to LiquidationCall, classify misses, send alerts
- **Telegram Helper** (`notify/telegram.ts`): Simple notification wrapper

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Required
RPC_URL=https://mainnet.base.org
WS_RPC_URL=wss://mainnet.base.org
SUBGRAPH_URL=https://gateway.thegraph.com/api/[key]/subgraphs/id/[id]
AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5

# Thresholds
MIN_DEBT_USD=50.0
HF_THRESHOLD_START=1.05
HF_THRESHOLD_EXECUTE=1.0

# Executor (required for PR2)
EXECUTOR_ADDRESS=0x...
EXECUTION_PRIVATE_KEY=0x...

# 1inch API (optional, for better rates)
ONEINCH_API_KEY=...

# Optional: Pair selection overrides (until per-user query implemented)
#COLLATERAL_ASSET=0x...
#DEBT_ASSET=0x...

# Notifications
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Oracles
CHAINLINK_FEEDS_JSON={"WETH":"0x...","USDC":"0x..."}
PYTH_WS_URL=wss://hermes.pyth.network/ws
PYTH_ASSETS=WETH,USDC,WBTC
PYTH_STALE_SECS=60
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
npm start

# Watch mode (development)
npm run dev

# Lint
npm run lint

# Type check
npm run typecheck
```

## Patterns Ported from Old Bot

### SubgraphService
- Gateway auth header mode (`Authorization: Bearer`)
- `extractAddress()` helper for composite IDs
- Zod schemas for type safety
- Minimal retry logic with exponential backoff

### SubgraphSeeder
- Variable debt + stable debt + aToken queries
- Union & dedupe user addresses
- Pagination with politeness delays
- Comprehensive metrics logging

### Chainlink Listener
- **STRICT**: OCR2 `NewTransmission` only (NOT `AnswerUpdated`)
- Prevents duplicate price-trigger scans
- Per-roundId deduplication

### Pyth Listener
- WebSocket subscription to Hermes
- Expo conversion for prices
- Staleness detection
- Auto-reconnect with exponential backoff
- Support for env overrides (`PYTH_FEED_IDS_JSON`)

## Non-Goals

The following are **explicitly out of scope**:

- ❌ Mempool sniping (Base has no public mempool)
- ❌ Private bundles / relay logic (simple EIP-1559 tx only)
- ❌ Feature flags explosion (keep config minimal)

## Implementation Notes

### Executor ABI
The executor client uses the **exact ABI** from the old bot:
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

### Constraints
- **No mempool sniping**: Submit simple EIP-1559 tx to public RPC
- **Subgraph for seeding only**: Not used for realtime triggers
- **Chainlink OCR2 only**: NewTransmission events, not AnswerUpdated
- **Pyth env-driven**: Feed IDs via PYTH_FEED_IDS_JSON, no hardcoding
- **Structured logs**: Minimal, never log secrets

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage (optional)
npm run test -- --coverage
```

Current test coverage:
- Config validation (2 tests)
- DirtyQueue (6 tests)
- AttemptHistory (5 tests)

**Total: 13 tests passing ✅**

## License

MIT
