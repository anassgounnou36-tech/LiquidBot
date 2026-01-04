# LiquidBot Backend V2

**Status:** Production-ready with enhanced monitoring and configuration

## Overview

Backend V2 is a production-grade Aave V3 Base liquidation detection system with:

- **Universe Seeding**: Comprehensive borrower discovery from Aave V3 Base subgraph with configurable caps
- **Active Risk Set**: On-chain health factor checks using Multicall3 with minimum debt filtering
- **Oracle Integration**: 
  - Chainlink OCR2 (NewTransmission only - no AnswerUpdated)
  - Cache-first pricing with configurable TTL
  - Price source counters for monitoring
- **Real-time Monitoring**: 
  - Block listener → HF checks → price-triggered rechecks
  - Per-block heartbeat logging
  - Live event traces for Aave Pool events
- **Execution Pipeline**: Complete liquidation execution with 1inch integration

## Architecture

```
backend-v2/
├── src/
│   ├── config/         # Strict env validation (zod)
│   ├── providers/      # RPC/WS providers (Base)
│   ├── subgraph/       # Subgraph queries + universe seeding
│   ├── prices/         # Chainlink listeners with cache-first architecture
│   ├── risk/           # ActiveRiskSet + HealthFactorChecker + VerifierLoop
│   ├── realtime/       # Block/event/price orchestration + DirtyQueue
│   ├── execution/      # Flashloan execution path + 1inch integration
│   ├── audit/          # Liquidation audit + classification
│   ├── metrics/        # Performance metrics + block heartbeat
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

# Capacity configuration
UNIVERSE_MAX_CANDIDATES=100000  # Max borrowers to seed from subgraph
PRICE_CACHE_TTL_MS=8000         # Price cache TTL in milliseconds

# Monitoring (optional)
LOG_BLOCK_HEARTBEAT=false       # Enable per-block heartbeat logging
BLOCK_HEARTBEAT_EVERY_N=1       # Log every N blocks
LOG_LIVE_EVENTS=false           # Enable live event trace logging
LOG_LIVE_EVENTS_ONLY_WATCHED=true  # Only log events for watched users

# Executor (for execution mode)
EXECUTOR_ADDRESS=0x...
EXECUTION_PRIVATE_KEY=0x...

# Notifications
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Oracles
CHAINLINK_FEEDS_JSON={"WETH":"0x...","USDC":"0x..."}
# Optional: Address-first pricing for execution path
CHAINLINK_FEEDS_BY_ADDRESS_JSON={"0x4200...":"0x7104..."}
```

## Monitoring & Observability

### Block Heartbeat

Enable per-block heartbeat logging to monitor system health:

```bash
LOG_BLOCK_HEARTBEAT=true
BLOCK_HEARTBEAT_EVERY_N=10  # Log every 10 blocks
```

Heartbeat logs include:
- Risk set size (total users being monitored)
- Users below liquidation threshold
- Minimum health factor among watched users
- Price source hit counters (listener/local/RPC)

Example:
```
[heartbeat] block=12345678 riskSet=1234 belowThreshold=5 minHF=1.0234 priceHits(listener=456,local=123,rpc=2)
```

### Live Event Traces

Enable live event traces to monitor Aave Pool activity:

```bash
LOG_LIVE_EVENTS=true
LOG_LIVE_EVENTS_ONLY_WATCHED=true  # Only log events for users in risk set
```

Traces include:
- Event type (Borrow, Repay, Supply, Withdraw)
- Block number and transaction hash
- User and reserve addresses
- Whether user is being watched

Example:
```
[event] Borrow block=12345678 tx=0x1234abcd... user=0xabcd1234... reserve=0x4200... watched=true
```

### Capacity Audit

On startup, the bot logs a capacity audit showing:
- Universe seeding cap and source (env var or default)
- Queue and set capacities
- MIN_DEBT_USD filter value
- Price cache TTL

### Price Cache Architecture

The bot uses a three-layer cache architecture for prices:

1. **Local cache** (TTL-based): Fast in-memory cache with configurable TTL
2. **Listener cache**: Updated by Chainlink OCR2 events in real-time
3. **RPC fallback**: Direct RPC calls only when caches miss

Configure TTL via:
```bash
PRICE_CACHE_TTL_MS=8000  # 8 seconds (default)
```

Price source counters track cache hit rates:
- `listenerHits`: Prices from Chainlink event listeners
- `localHits`: Prices from local TTL cache
- `rpcFallbacks`: Prices fetched via RPC (should be minimal)

### Minimum Debt Filtering

Users below `MIN_DEBT_USD` are automatically filtered:
- At admission to ActiveRiskSet
- During health factor updates
- When checking liquidation eligibility

This prevents wasting resources on dust positions.
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
- Three-layer cache architecture (local → listener → RPC)
- Configurable TTL for local cache

### Price Math
- Cache-first architecture with minimal RPC calls
- Per-symbol warning cooldown (15s) to reduce noise
- Price source counters for monitoring
- Supports direct feeds and ratio feeds (e.g., wstETH/ETH × ETH/USD)

## Removed Features

The following features from earlier versions have been removed or disabled:

- ❌ Pyth integration (Chainlink-only for simplicity)
- ❌ RealtimeOrchestrator (replaced by DirtyQueue + VerifierLoop)

## Production Deployment

### Recommended Settings

For production deployment on Base mainnet:

```bash
# Universe
UNIVERSE_MAX_CANDIDATES=100000

# Price cache
PRICE_CACHE_TTL_MS=8000  # 8 seconds

# Monitoring (enable for first few days, then disable)
LOG_BLOCK_HEARTBEAT=true
BLOCK_HEARTBEAT_EVERY_N=10
LOG_LIVE_EVENTS=false
LOG_LIVE_EVENTS_ONLY_WATCHED=true

# Risk thresholds
MIN_DEBT_USD=50.0
HF_THRESHOLD_START=1.05
HF_THRESHOLD_EXECUTE=1.0

# Execution
EXECUTION_ENABLED=false  # Start with dry-run, enable after validation

## License

MIT
