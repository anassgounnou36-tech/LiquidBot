# Oracle Tools - CLI Usage

Command-line utilities for oracle discovery, validation, and testing.

## Tools Overview

| Script | Purpose | Use When |
|--------|---------|----------|
| `discover-twap-pools.mjs` | Discover Uniswap V3 pools for TWAP | Initial setup, adding new assets |
| `test-pyth-hermes.mjs` | Validate Pyth Hermes connectivity | Initial setup, troubleshooting |
| `test-twap-sanity.mjs` | Compare TWAP vs Chainlink | After pool discovery, periodic validation |

## discover-twap-pools.mjs

Discovers and ranks Uniswap V3 pools for TWAP oracle usage.

### Basic Usage

```bash
# Discover pools for default assets (WETH, cbETH, WBTC)
node scripts/discover-twap-pools.mjs

# Specify custom assets
TWAP_TARGETS=WETH,cbETH,USDC node scripts/discover-twap-pools.mjs
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Base RPC endpoint | **Required** |
| `TWAP_TARGETS` | Comma-separated asset symbols | `WETH,cbETH,WBTC` |
| `AAVE_PROTOCOL_DATA_PROVIDER` | Aave data provider address | `0xC4Fcf9893072d61Cc2899C0054877Cb752587981` |
| `MIN_LIQUIDITY` | Minimum pool liquidity threshold | `0` |

### Example Output

```
🔍 TWAP Pool Discovery for Base Network
=========================================

RPC URL: https://mainnet.base.org
Targets: WETH, cbETH, WBTC
Quote Tokens: USDC, WETH
Fee Tiers: 500, 3000, 10000

📊 Discovering pools for WETH...
------------------------------------------------------------
Token Address: 0x4200000000000000000000000000000000000006
  ✅ Found pool: 0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18 (USDC, fee 500, liquidity: 12345678901234567890)
  ✅ Found pool: 0xd0b53D9277642d899DF5C87A3966A349A798F224 (USDC, fee 3000, liquidity: 98765432109876543210)

  🏆 Best pool for WETH:
     Address: 0xd0b53D9277642d899DF5C87A3966A349A798F224
     Quote: USDC
     Fee: 3000
     Liquidity: 98765432109876543210
     Observation Cardinality: 1000

✨ TWAP_POOLS Configuration
=========================================

[
  {
    "symbol": "WETH",
    "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    "dex": "uniswap_v3",
    "fee": 3000,
    "quote": "USDC",
    "liquidity": "98765432109876543210"
  }
]

Ready to paste into .env:
TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3","fee":3000,"quote":"USDC"}]'

✅ Discovery complete
```

### Troubleshooting

**No pools found:**
- Verify token exists on Base and has Uniswap V3 liquidity
- Check `TWAP_TARGETS` spelling matches token list
- Try lowering `MIN_LIQUIDITY` threshold

**RPC errors:**
- Verify `RPC_URL` is accessible and supports Base mainnet
- Check rate limits on your RPC provider

## test-pyth-hermes.mjs

Validates Pyth Hermes REST and SSE connectivity.

### Basic Usage

```bash
# Test with default configuration
node scripts/test-pyth-hermes.mjs

# Test specific assets
PYTH_ASSETS=WETH,cbETH node scripts/test-pyth-hermes.mjs

# Test with custom feed map
PYTH_FEED_MAP_PATH=./config/pyth-feeds.json node scripts/test-pyth-hermes.mjs
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PYTH_HTTP_URL` | Pyth Hermes REST endpoint | `https://hermes.pyth.network` |
| `PYTH_ASSETS` | Comma-separated asset symbols | `WETH,WBTC,cbETH,USDC` |
| `PYTH_FEED_MAP_PATH` | Path to feed map JSON | `""` (uses defaults) |
| `PYTH_STALE_SECS` | Staleness threshold in seconds | `10` |
| `SSE_DURATION_SEC` | SSE stream test duration | `10` |

### Example Output

```
🔍 Pyth Hermes Connectivity Test
=========================================

HTTP URL: https://hermes.pyth.network
Assets: WETH, WBTC, cbETH, USDC
Feed Map Path: (none - using defaults)
Staleness Threshold: 10s

📡 Testing REST API...
------------------------------------------------------------
  ✅ WETH (0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace):
     Price: 3250000000 (expo: -8, conf: 1500000)
     Publish Time: 1701792345 (2023-12-05T20:19:05.000Z)
     Age: 2s ✅ FRESH

  ✅ WBTC (0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43):
     Price: 4200000000000 (expo: -8, conf: 2000000)
     Publish Time: 1701792344 (2023-12-05T20:19:04.000Z)
     Age: 3s ✅ FRESH

📡 Testing SSE stream for 10s...
------------------------------------------------------------
SSE stream connected (status: 200)

📊 SSE Summary (10s):
   Total ticks: 42
   Unique feeds: 4
   0xff61491a93...: 12 updates
   0xe62df6c8b4...: 10 updates
   0x15ecddd26d...: 11 updates
   0xeaa020c61c...: 9 updates

✨ Test Summary
=========================================

REST Tests: 4/4 passed
SSE Tests: 42 ticks received in 10s

✅ All tests passed - Pyth Hermes connectivity confirmed
```

### Troubleshooting

**REST tests fail:**
- Verify `PYTH_HTTP_URL` is correct
- Check feed IDs in `PYTH_FEED_MAP_PATH` are valid
- Verify network connectivity to Pyth Hermes

**Stale prices:**
- Increase `PYTH_STALE_SECS` if Pyth updates are infrequent
- Check if feed is actively maintained by Pyth

**SSE no updates:**
- Verify firewall allows SSE/WebSocket connections
- Check network supports EventSource/streaming
- Try increasing `SSE_DURATION_SEC` for low-frequency feeds

## test-twap-sanity.mjs

Compares TWAP prices against Chainlink for sanity checking.

### Basic Usage

```bash
# Via environment variable (traditional method)
TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]' node scripts/test-twap-sanity.mjs

# Via CLI argument (recommended for Windows - avoids shell escaping issues)
node scripts/test-twap-sanity.mjs --twap-pools '[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]'

# Via JSON file (easiest for multiple pools)
node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json

# With custom window and delta thresholds
node scripts/test-twap-sanity.mjs --twap-pools-file ./pools.json --window 600 --delta 0.02
```

### CLI Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--twap-pools <json>` | JSON array of pool configurations | - |
| `--twap-pools-file <path>` | Path to JSON file with pool configurations | - |
| `--window <seconds>` | TWAP observation window in seconds | `300` |
| `--delta <percentage>` | Max allowed delta as decimal | `0.012` (1.2%) |
| `--help` | Show help message | - |

**Priority**: CLI arguments take precedence over environment variables.
1. `--twap-pools` (highest priority)
2. `--twap-pools-file`
3. `TWAP_POOLS` environment variable (lowest priority)

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Base RPC endpoint | **Required** |
| `TWAP_POOLS` | JSON array of pool configs | **Required** (if no CLI args) |
| `TWAP_WINDOW_SEC` | TWAP observation window (seconds) | `300` |
| `TWAP_DELTA_PCT` | Max allowed delta (decimal) | `0.012` (1.2%) |
| `CHAINLINK_FEEDS` | Comma-separated "SYMBOL:ADDRESS" | `""` |

### Pool Configuration Format

**Direct JSON Array**:
```json
[
  {
    "symbol": "WETH",
    "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    "dex": "uniswap_v3"
  }
]
```

**JSON File with Wrapper** (also supported):
```json
{
  "pools": [
    {
      "symbol": "WETH",
      "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
      "dex": "uniswap_v3",
      "fee": 500,
      "quote": "USDC"
    }
  ]
}
```

Both formats are supported when using `--twap-pools-file`. See `config/twap-pools.sample.json` for a complete example.

### Example Output

```
🔍 TWAP Sanity Check
=========================================

RPC URL: https://mainnet.base.org
TWAP Window: 300s
Max Delta: 1.20%

Testing 3 pool(s)...

📊 WETH (uniswap_v3)
------------------------------------------------------------
Pool: 0xd0b53D9277642d899DF5C87A3966A349A798F224
  TWAP Price: 3250.456123 (avg tick: 123456.78)
  Chainlink Price: 3251.120000 (age: 12s)
  Delta: 0.663877 (0.02%)
  ✅ PASS - Delta within threshold

📊 cbETH (uniswap_v3)
------------------------------------------------------------
Pool: 0x8a7d6f4d6e39c8a4e6c2d9f8b7a6c5e4d3c2b1a0
  TWAP Price: 3520.789456 (avg tick: 234567.89)
  Chainlink Price: 3525.650000 (age: 8s)
  Delta: 4.860544 (0.14%)
  ✅ PASS - Delta within threshold

✨ Summary
=========================================

Total: 3
Passed: 3
Failed: 0

  ✅ PASS WETH (Δ 0.02%)
  ✅ PASS cbETH (Δ 0.14%)
  ✅ PASS WBTC (Δ 0.08%)

✅ All TWAP sanity checks passed
```

### Troubleshooting

**No configuration provided:**
- Use one of the three input methods: CLI argument, JSON file, or environment variable
- CLI arguments are recommended for Windows users to avoid shell escaping issues
- Use `--help` to see all options and examples

**TWAP computation fails:**
- Verify pool has sufficient observation cardinality
- Reduce `TWAP_WINDOW_SEC` if pool is newly created
- Check RPC endpoint supports historical queries

**High delta percentage:**
- Increase `TWAP_DELTA_PCT` if deltas are consistently acceptable
- Verify pool has sufficient liquidity (low liquidity = high slippage)
- Check if extreme price movements occurred during window

**Chainlink fetch fails:**
- Verify `CHAINLINK_FEEDS` addresses are correct for Base
- Check RPC connectivity
- Verify feed is active on Base network

**Windows shell issues with JSON:**
- Use `--twap-pools-file` instead of inline JSON to avoid escaping problems
- If using `--twap-pools`, ensure proper quoting (single quotes may not work in CMD)
- PowerShell users: escape quotes properly or use a JSON file

### Technical Notes

**BigInt-Safe TWAP Calculation:**

The TWAP calculation uses BigInt arithmetic to avoid precision loss with large tick cumulative values:

```javascript
const delta = tickCumulatives[0] - tickCumulatives[1];  // Keep as BigInt
const time = BigInt(windowSec);
const avgTick = Number(delta / time) + Number(delta % time) / Number(time);
```

**Why this matters:**
- Tick cumulatives grow unbounded over time (they represent cumulative time-weighted ticks since pool creation)
- Converting large BigInt values directly to Number can lose precision or cause overflow
- By keeping the delta calculation in BigInt and only converting the final average, we preserve accuracy
- The formula splits the division into integer and fractional parts for maximum precision

**Price Normalization:**
- TWAP price represents `token1/token0` (e.g., for WETH/USDC pool: USDC per WETH)
- For pools where token0=WETH and token1=USDC, TWAP gives USD-equivalent price directly comparable to Chainlink's WETH/USD feed
- Always verify token0/token1 addresses in output to ensure correct price interpretation

## Common Workflows

### Initial Setup

```bash
# 1. Discover pools
node scripts/discover-twap-pools.mjs

# 2a. Save output to a JSON file (recommended)
# Copy the JSON output from step 1 to config/twap-pools.json

# 2b. Or copy output to .env as TWAP_POOLS (traditional method)
# TWAP_POOLS='[...]'

# 3. Test Pyth connectivity
PYTH_FEED_MAP_PATH=./config/pyth-feeds.json node scripts/test-pyth-hermes.mjs

# 4. Validate TWAP sanity using file (recommended)
node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json

# 4b. Or validate using environment variable
# node scripts/test-twap-sanity.mjs
```

### Adding New Asset

```bash
# 1. Discover pool for new asset
TWAP_TARGETS=NEW_ASSET node scripts/discover-twap-pools.mjs

# 2. Add to PYTH_FEED_MAP_PATH if using Pyth

# 3. Update your twap-pools.json file with the new pool

# 4. Run sanity check
node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json
```

### Periodic Validation

```bash
# Run weekly or after major price movements
node scripts/test-pyth-hermes.mjs
node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json
```

### Windows-Specific Workflows

On Windows, JSON in command-line arguments can be problematic. Use file-based configuration:

```powershell
# PowerShell - use file-based config
node scripts/test-twap-sanity.mjs --twap-pools-file .\config\twap-pools.json

# Or set environment variable and use default loading
$env:TWAP_POOLS = Get-Content .\config\twap-pools.json -Raw
node scripts/test-twap-sanity.mjs
```

```cmd
REM CMD - use file-based config
node scripts/test-twap-sanity.mjs --twap-pools-file .\config\twap-pools.json
```

## See Also

- [Oracle Setup Guide](../docs/tools/oracle-setup.md) - Step-by-step configuration
- [Pyth Network Docs](https://docs.pyth.network/)
- [Uniswap V3 Oracle](https://docs.uniswap.org/concepts/protocol/oracle)
