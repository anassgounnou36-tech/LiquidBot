# Manual Verification Checklist

## Pre-Deployment Testing

Use this checklist to verify the RPC optimization changes are working correctly before deploying to production.

### 1. Provider Wiring Verification

**Test: HTTP Transport Enabled (Default)**
```bash
# Set environment
export ETH_CALL_TRANSPORT=HTTP
export RPC_URL=<your-http-rpc-url>
export WS_RPC_URL=<your-ws-rpc-url>

# Start the backend
npm run dev

# ✅ Expected Log:
# [provider] ws_ready; using HTTP for eth_call operations; WS reserved for subscriptions (url=https://...)
```

**Test: WS Transport (Legacy Fallback)**
```bash
export ETH_CALL_TRANSPORT=WS

# ✅ Expected Log:
# [provider] ws_ready; using WebSocket for eth_call operations
```

### 2. In-Flight Limiting Verification

**Test: Global Limiter Initialization**
```bash
export ETH_CALL_MAX_IN_FLIGHT=50

# ✅ Expected Log:
# [rpc-rate-limiter] Initialized: rate=50/s, burst=100, refillInterval=100ms, tokensPerRefill=5.00, maxInFlight=50
```

**Test: In-Flight Slot Acquisition**
- Watch logs during high load (e.g., large price drops)
- Look for successful chunk completions

```
# ✅ Expected Logs (during multicall):
# [realtime-hf] Chunk 1/10 complete (250 calls, 1.23s, provider=primary)
# (No "failed to acquire in-flight slot" errors under normal load)
```

**Test: In-Flight Wait Queue (Stress Test)**
- Temporarily set `ETH_CALL_MAX_IN_FLIGHT=5` (very low)
- Trigger multiple scans simultaneously

```bash
export ETH_CALL_MAX_IN_FLIGHT=5

# ⚠️ Expected Warnings (under extreme load):
# [realtime-hf] Chunk X failed to acquire in-flight slot (max=5)
```

### 3. Price Trigger Min Interval Verification

**Test: Min Interval Enforcement**
```bash
export PRICE_TRIGGER_MIN_INTERVAL_SEC=15
export PRICE_TRIGGER_ENABLED=true

# Trigger rapid price updates (e.g., on testnet or via mock)
# Wait for second update within 15 seconds

# ✅ Expected Log:
# [price-trigger] scan suppressed: symbol=WETH block=XXXXX reason=min_interval elapsed=5.2s min=15s
```

**Test: Min Interval Expiry**
- Wait for min interval to expire (e.g., >15 seconds)
- Trigger another price update

```
# ✅ Expected Log:
# [price-trigger] scan scheduled: symbol=WETH block=XXXXX reason=NewTransmission dedup=miss inflight_skip=false drop=12.50bps
```

### 4. Misconfiguration Guards Verification

**Test: PRICE_TRIGGER_POLL_SEC=0 (Disable Polling)**
```bash
export PRICE_TRIGGER_POLL_SEC=0

# ✅ Expected Log:
# [price-trigger] PRICE_TRIGGER_POLL_SEC=0: polling disabled (event-only mode)
```

**Test: PRICE_TRIGGER_POLL_SEC<5 (Clamp to 5)**
```bash
export PRICE_TRIGGER_POLL_SEC=2

# ✅ Expected Logs:
# [price-trigger] PRICE_TRIGGER_POLL_SEC=2 is too low, clamped to 5s minimum (prevents tight loops and RPC saturation)
# [price-trigger] Starting polling fallback: interval=5s ...
```

**Test: PRICE_TRIGGER_POLL_SEC>=5 (No Warning)**
```bash
export PRICE_TRIGGER_POLL_SEC=25

# ✅ Expected Log (no warning):
# [price-trigger] Starting polling fallback: interval=25s ...
```

### 5. End-to-End Scenario Testing

**Scenario 1: Steady State (No Price Moves)**
- Let bot run for 5-10 blocks with no significant price changes

```
# ✅ Expected Behavior:
# - Only "[realtime-hf] Head-check run complete" logs (~100-150 calls per block)
# - No "[price-trigger] Emergency scan complete" logs
# - No "trigger=price" batch logs
```

**Scenario 2: Price Drop Event**
- Trigger Chainlink NewTransmission with >12bps drop

```
# ✅ Expected Sequence:
# 1. [price-trigger] Sharp price drop detected (event): asset=WETH drop=15.23bps ...
# 2. [price-trigger] scan scheduled: symbol=WETH block=XXXXX reason=NewTransmission ...
# 3. [price-trigger] scan filtering: symbol=WETH block=XXXXX rawIndexCount=547 nearBandCount=87 scannedCount=87
# 4. [price-trigger-targeted] mini-multicall complete latency=234ms subset=87
```

**Scenario 3: Rapid Price Events (Deduplication)**
- Trigger multiple price events in same block

```
# ✅ Expected Behavior:
# - First event schedules scan
# - Subsequent events log: "scan suppressed: reason=already_processed_this_block dedup=hit"
```

**Scenario 4: Min Interval Suppression**
- Trigger price event
- Wait <10 seconds
- Trigger another price event for same asset

```
# ✅ Expected Logs:
# - First: scan scheduled and executed
# - Second: "scan suppressed: reason=min_interval elapsed=3.5s min=10s"
```

### 6. Metrics Verification

**Check Prometheus Metrics (if enabled)**
```bash
curl http://localhost:3000/metrics | grep rpc_rate_limit

# ✅ Expected Metrics:
# rpc_rate_limit_waits_total
# rpc_rate_limit_drops_total
# rpc_rate_limit_tokens_available
```

**Check GlobalRpcRateLimiter Stats**
- Add a debug endpoint or log stats periodically

```typescript
// In RealTimeHFService or debug endpoint:
const stats = this.globalRpcRateLimiter.getStats();
console.log('[limiter-stats]', stats);

// ✅ Expected Output:
// [limiter-stats] {
//   tokens: 95.4,
//   burstCapacity: 100,
//   rateLimit: 50,
//   totalWaits: 12,
//   totalDrops: 0,
//   inFlightCalls: 8,
//   maxInFlight: 120,
//   totalInFlightWaits: 3
// }
```

### 7. Load Testing

**Test: High Concurrency**
- Simulate multiple simultaneous scans (head + price + reserve)
- Monitor for in-flight slot contention

```bash
# ✅ Expected Behavior:
# - Chunks complete successfully
# - Some may wait briefly for slots (logged if >100ms wait)
# - No "failed to acquire" errors (unless misconfigured too low)
```

**Test: Provider Errors**
- Temporarily misconfigure RPC_URL to trigger 429 errors
- Verify backoff and recovery

```
# ✅ Expected Behavior:
# - Chunk retries with exponential backoff
# - Secondary provider fallback (if configured)
# - Eventually recovers when RPC fixed
```

## Rollback Testing

**Test: Disable All Features**
```bash
export ETH_CALL_TRANSPORT=WS
export PRICE_TRIGGER_GLOBAL_RATE_LIMIT=off
export PRICE_TRIGGER_MIN_INTERVAL_SEC=0

# ✅ Expected Behavior:
# - Reverts to legacy WS behavior
# - No in-flight limiting
# - No min interval enforcement
# - System continues to function normally
```

## Sign-Off Checklist

Before deploying to production, ensure:

- [ ] HTTP transport log appears on startup
- [ ] In-flight limiter initializes with correct maxInFlight
- [ ] Price trigger min interval enforcement works
- [ ] Polling misconfiguration guards trigger correctly
- [ ] Steady state shows no per-block price scans
- [ ] Price drops trigger near-band scans (not full 500+ candidates)
- [ ] No WS concurrency errors under load
- [ ] Metrics are being tracked correctly
- [ ] Rollback works (ETH_CALL_TRANSPORT=WS)

## Monitoring After Deployment

Watch for these indicators:

**Success Indicators:**
- Startup log: `[provider] ws_ready; using HTTP for eth_call operations`
- Suppression logs: `[price-trigger] scan suppressed: reason=min_interval`
- Reduced RPC call volume per block in steady state
- No WS "exceeded 200 concurrent requests" errors

**Warning Indicators:**
- Frequent in-flight slot waits (may need to increase ETH_CALL_MAX_IN_FLIGHT)
- Token bucket depletion (may need to increase GLOBAL_RPC_RATE_LIMIT)
- Price scans still occurring every block (check PRICE_TRIGGER_MIN_INTERVAL_SEC)

**Error Indicators:**
- "failed to acquire in-flight slot" errors (ETH_CALL_MAX_IN_FLIGHT too low)
- Chunk timeout spikes (provider overload, increase ETH_CALL_MAX_IN_FLIGHT)
- Missing price scans on legitimate drops (min interval too aggressive)
