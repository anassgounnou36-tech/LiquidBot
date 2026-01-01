# LiquidBot Backend V2

**Status:** PR1 - Foundation + Universe Seeding + Oracles

## Overview

Backend V2 is a clean-slate rebuild of the Aave V3 Base liquidation detection system, implementing only the foundation required for PR1:

- **Universe Seeding**: Comprehensive borrower discovery from Aave V3 Base subgraph
- **Active Risk Set**: On-chain health factor checks using Multicall3
- **Oracle Integration**: 
  - Chainlink OCR2 (NewTransmission only - no AnswerUpdated)
  - Pyth Hermes WebSocket with staleness detection
- **Real-time Monitoring**: Block listener → HF checks → price-triggered rechecks

## Architecture

```
backend-v2/
├── src/
│   ├── config/         # Strict env validation (zod)
│   ├── providers/      # RPC/WS providers (Base)
│   ├── subgraph/       # Subgraph queries + universe seeding
│   ├── prices/         # Chainlink + Pyth listeners
│   ├── risk/           # ActiveRiskSet + HealthFactorChecker
│   ├── realtime/       # Block/event/price orchestration
│   ├── execution/      # [PR2] Flashloan execution path
│   ├── audit/          # [PR2] Liquidation audit + classification
│   ├── notify/         # Telegram notifications
│   └── index.ts        # Main entry point
```

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

# Executor (for PR2)
EXECUTOR_ADDRESS=0x...
EXECUTION_PRIVATE_KEY=0x...

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

## Non-Goals (PR1)

The following are **explicitly out of scope** for PR1:

- ❌ Mempool sniping (Base has no public mempool)
- ❌ Private bundles / relay logic
- ❌ Execution path (flashloan call) - reserved for PR2
- ❌ Audit classification - reserved for PR2
- ❌ Feature flags explosion

## What's Next (PR2)

- Flashloan execution path
- 1inch swap routing
- Liquidation audit & race classification
- Profitability analysis
- Historical tracking

## License

MIT
