# Predictive End-to-End Test Harness

## Overview

The predictive E2E test harness validates the bot's complete predictive liquidation pipeline when Pyth Network (early warning) and Chainlink (oracle-of-record) are used together. This test ensures that:

1. **Pyth price updates** trigger the predictive orchestrator to enqueue candidates
2. **Micro-verification** runs on predictive signals
3. **Chainlink confirmation** triggers reserve-targeted rechecks
4. **Profitability gates** are evaluated correctly

The test uses a local Base fork with a seeded near-threshold Aave v3 position and simulates the full price signal flow.

## Prerequisites

### Required Software

- **Node.js** 18.18.0+ and npm 9.0.0+
- **Anvil** (from Foundry) - for running the Base mainnet fork
  - Install: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Base RPC URL** - Required for forking Base mainnet
  - Free option: https://mainnet.base.org
  - Recommended: Alchemy or Infura for better reliability

### Environment Setup

1. **Clone and install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure fork RPC in `.env`:**
   ```bash
   # Add to backend/.env
   HARDHAT_FORK_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   # Or use public RPC (may be slower)
   HARDHAT_FORK_URL=https://mainnet.base.org
   
   # Test wallet private key (optional, uses Hardhat default if not set)
   FORK_TEST_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

## Running the Test

### One-Command Execution

From the `backend` directory:

```bash
npm run predictive:e2e
```

This single command will:
1. Start a Base mainnet fork (if not already running)
2. Seed a near-threshold Aave v3 WETH/USDC position
3. Start a mock Pyth WebSocket server
4. Start the backend with predictive configuration
5. Emit a Pyth price update crossing the delta threshold
6. Verify predictive enqueue and micro-verify execution
7. Simulate Chainlink confirmation via block mining
8. Verify reserve recheck and profitability evaluation
9. Report PASS/FAIL with detailed logs

### Expected Runtime

- **Total duration:** 2-4 minutes
- **Breakdown:**
  - Fork startup: 5-10 seconds
  - Position seeding: 10-30 seconds
  - Backend startup: 60-90 seconds
  - Test execution: 30-60 seconds
  - Cleanup: 5 seconds

## What the Test Does

### Phase 0: Setup (30-60 seconds)

1. **Fork Management**
   - Checks if a Base fork is running on `http://127.0.0.1:8545`
   - If not found, starts `anvil` with Base mainnet fork
   - Verifies chainId = 8453

2. **Position Seeding**
   - Uses `scripts/fork/setup-scenario.ts` to:
     - Wrap 1.0 ETH → WETH
     - Supply WETH as collateral to Aave v3
     - Borrow USDC to achieve HF ≈ 1.008 (near liquidation threshold)
   - Validates HF and position via on-chain queries

3. **Infrastructure Startup**
   - Starts Mock Pyth server on `ws://127.0.0.1:8999`
   - Starts backend with:
     - `PYTH_ENABLED=true`, `PYTH_WS_URL=ws://127.0.0.1:8999`
     - `PREDICTIVE_SIGNAL_GATE_ENABLED=true`
     - `PREDICTIVE_QUEUE_ENABLED=true`
     - `PREDICTIVE_MICRO_VERIFY_ENABLED=true`
     - `PRICE_TRIGGER_ENABLED=false` (isolate Pyth)
     - Reduced RPC load settings for fork stability

### Phase 1: Pyth Price Update (10 seconds)

1. **Price Update Emission**
   - Mock Pyth server sends WETH price update with 0.15% drop
   - Exceeds `PREDICTIVE_PYTH_DELTA_PCT=0.1%` threshold

2. **Log Assertions**
   - ✓ `[pyth-listener] Price update` received
   - ✓ Predictive orchestrator `enqueue` or `queue` activity
   - ✓ `micro-verify` or `trigger=price` batch scheduled

### Phase 2: Chainlink Confirmation (15 seconds)

1. **Oracle Update Simulation**
   - Mines 5 blocks to trigger:
     - Aave oracle price updates
     - Reserve index updates
     - Backend's polling-based price checks

2. **Log Assertions**
   - ✓ `ReserveDataUpdated` or `reserve-recheck` triggered
   - ✓ Profitability evaluation (`profit`, `MIN_PROFIT`) logged
   - ✓ Batch processing completed

### Phase 3: Validation & Reporting

- Collects last 300 lines of backend logs
- Checks all assertions
- Prints detailed summary:
  - **PASS**: All pipeline steps executed correctly
  - **FAIL**: Shows which assertion failed + full logs

## Expected Output

### Successful Test Run

```
[e2e-test] Starting Predictive E2E Test: Pyth + Chainlink
================================================================================
[e2e-test] Checking for Base fork...
[e2e-test] ✓ Base fork is already running
[e2e-test] Current WETH price: $3842.50
[e2e-test] Seeding near-threshold Aave position...
Using test wallet: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
...
[e2e-test] ✓ Position seeded successfully
[e2e-test] Starting Mock Pyth server on ws://127.0.0.1:8999...
[mock-pyth] Server listening on ws://127.0.0.1:8999
[e2e-test] ✓ Mock Pyth server started
[e2e-test] Starting backend with predictive configuration...
[e2e-test] ✓ Aave metadata initialized
[e2e-test] ✓ Feed decimals initialized
[e2e-test] ✓ Borrowers index ready
[e2e-test] ✓ WebSocket heartbeat started
[e2e-test] ✓ Backend startup complete

=== PHASE 1: Pyth Price Update (Early Warning) ===
[e2e-test] Sending WETH price update: $3842.50 → $3836.74 (0.15% drop)
[mock-pyth] Sent WETH price update: $3836.74 to 1 client(s)
[pyth-listener] Price update: WETH=$3836.74 (age: 0.1s)
[predictive-orchestrator] Enqueued 1 user(s) for micro-verify
[realtime-hf] Micro-verify batch: trigger=price users=1
[e2e-test] Waiting 10000ms for backend to process...

Pyth Update Assertions:
  • Pyth price update received: ✓
  • Predictive enqueue triggered: ✓
  • Micro-verify scheduled: ✓
[e2e-test] ✓ Pyth phase complete

=== PHASE 2: Chainlink Confirmation (Oracle-of-Record) ===
[e2e-test] Mining blocks to trigger Chainlink/Aave oracle updates...
[chainlink-impersonator] Mined 5 blocks
[e2e-test] Waiting 15000ms for reserve rechecks...
[realtime-hf] ReserveDataUpdated: WETH reserve=0x4200...
[reserve-recheck] Rechecking 50 borrowers for WETH
[execution] Profitability check: minProfit=$1.00 gasUSD=$0.50 netProfit=$2.30 ✓

Chainlink Confirmation Assertions:
  • Reserve recheck triggered: ✓
  • Profitability evaluation: ✓
  • Batch processing: ✓
[e2e-test] ✓ Chainlink phase complete

================================================================================
PYTH+CHAINLINK PREDICTIVE E2E TEST SUMMARY
================================================================================
✓ PASS: All assertions passed

Pipeline flow validated:
  1. Pyth price update received
  2. Predictive orchestrator enqueued candidates
  3. Micro-verify triggered for price event
  4. Reserve recheck executed on oracle update
  5. Profitability gates evaluated
```

## Troubleshooting

### Fork RPC Timeouts

**Symptoms:**
- Backend logs show RPC timeouts
- Multicall operations failing
- Head check stalls

**Solution:**
Reduce RPC load in test environment (already configured in test script):
```bash
HEAD_CHECK_PAGE_SIZE=300          # Default: 2400
RESERVE_RECHECK_TOP_N=50          # Default: 800
MULTICALL_BATCH_SIZE=80           # Default: 120
```

### Fork Not Starting

**Symptoms:**
- `Fork failed to start within timeout`
- `ECONNREFUSED 127.0.0.1:8545`

**Solutions:**

1. **Check anvil is installed:**
   ```bash
   anvil --version
   # If not found, install Foundry
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Verify fork URL in .env:**
   ```bash
   # Must be a valid Base RPC
   HARDHAT_FORK_URL=https://mainnet.base.org
   ```

3. **Check port 8545 is free:**
   ```bash
   lsof -i :8545
   # If occupied, kill the process or change port
   ```

4. **Manual fork start:**
   ```bash
   # Terminal 1: Start fork manually
   anvil --fork-url https://mainnet.base.org --chain-id 8453
   
   # Terminal 2: Run test
   npm run predictive:e2e
   ```

### Backend Startup Timeout

**Symptoms:**
- `Backend startup timeout - required logs not seen`
- Backend starts but test fails before completing

**Solutions:**

1. **Check dependencies are installed:**
   ```bash
   npm install
   npm run build
   ```

2. **Verify fork is responding:**
   ```bash
   curl -X POST http://127.0.0.1:8545 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
   # Should return: {"jsonrpc":"2.0","result":"0x2105","id":1}
   ```

3. **Check for port conflicts:**
   - Backend API: port 3000
   - Mock Pyth: port 8999
   - Fork: port 8545

4. **Increase timeout in script:**
   Edit `scripts/predictive/e2e-pyth-chainlink.ts`:
   ```typescript
   const BACKEND_STARTUP_TIMEOUT_MS = 180000; // 3 minutes instead of 2
   ```

### Pyth Updates Not Detected

**Symptoms:**
- `Pyth price update not detected in logs`
- Mock Pyth shows 0 clients

**Solutions:**

1. **Verify Pyth configuration in backend:**
   The test script sets these, but verify logs show:
   ```
   [pyth-listener] Initialized: assets=WETH, staleSecs=30
   [pyth-listener] Connecting to ws://127.0.0.1:8999
   [pyth-listener] Connected
   [pyth-listener] Subscribed to 1 price feeds
   ```

2. **Check Mock Pyth server logs:**
   Should show:
   ```
   [mock-pyth] Server listening on ws://127.0.0.1:8999
   [mock-pyth] Client connected
   [mock-pyth] Subscription request for 1 feed(s)
   ```

3. **Verify WETH feed ID matches:**
   In `test-utils/mock-pyth-ws.ts` and `src/services/PythListener.ts`,
   WETH feed ID should be:
   ```
   0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
   ```

### Position Seeding Fails

**Symptoms:**
- `Setup failed with code 1`
- Borrow amount calculation errors
- Transaction reverts

**Solutions:**

1. **Check Hardhat account has balance:**
   ```bash
   # Anvil automatically funds default accounts
   # If using custom key, add balance manually
   cast balance 0xYourAddress --rpc-url http://127.0.0.1:8545
   ```

2. **Verify Aave pool has liquidity:**
   ```bash
   # Check USDC reserve on Base fork
   cast call 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5 \
     "getReserveData(address)" 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
     --rpc-url http://127.0.0.1:8545
   ```

3. **Reduce position size:**
   Edit `scripts/predictive/e2e-pyth-chainlink.ts`:
   ```typescript
   const TEST_ETH_DEPOSIT = '0.5'; // Reduce from 1.0 to 0.5
   ```

4. **Try fresh fork:**
   ```bash
   killall anvil
   npm run predictive:e2e  # Will start new fork
   ```

### Assertions Fail But Logs Look Correct

**Symptoms:**
- Test reports FAIL but recent logs show expected activity
- Timing-sensitive assertions miss events

**Solutions:**

1. **Increase wait times:**
   Edit `scripts/predictive/e2e-pyth-chainlink.ts`:
   ```typescript
   const PYTH_UPDATE_WAIT_MS = 15000;      // +5 seconds
   const CHAINLINK_UPDATE_WAIT_MS = 20000; // +5 seconds
   ```

2. **Check assertion patterns:**
   Log patterns may vary slightly. Verify in `testPythUpdate()` and
   `testChainlinkConfirmation()` that search strings match actual logs.

3. **Collect more logs for assertions:**
   ```typescript
   const recentLogs = backendLogs.slice(-200).join('\n'); // Increase from -100
   ```

## Advanced Usage

### Run with Custom Configuration

Override environment variables:

```bash
# Use different price drop
PRICE_DROP_PCT=0.2 npm run predictive:e2e

# Use higher delta threshold
PREDICTIVE_DELTA_PCT=0.15 npm run predictive:e2e

# Use different test wallet
FORK_TEST_PK=0x... npm run predictive:e2e
```

### Run with Existing Fork

If you already have a Base fork running:

```bash
# Terminal 1: Fork (already running)
anvil --fork-url https://mainnet.base.org --chain-id 8453

# Terminal 2: Test (will detect existing fork)
npm run predictive:e2e
```

### Inspect Failed Test State

On failure, the test leaves artifacts for inspection:

1. **Backend logs:** Printed in test output (last 300 lines)
2. **Fork state:** Fork continues running after test exits
3. **Position inspection:**
   ```bash
   # Get test wallet address from logs
   WALLET=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   
   # Check position on fork
   cast call 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5 \
     "getUserAccountData(address)" $WALLET \
     --rpc-url http://127.0.0.1:8545
   ```

### Debug Backend Logs

To see all backend output during test:

Edit `scripts/predictive/e2e-pyth-chainlink.ts`, in `startBackend()`:

```typescript
// Print all backend output (not just filtered logs)
if (backendProcess.stdout) {
  backendProcess.stdout.on('data', (data) => {
    const line = data.toString();
    backendLogs.push(line);
    process.stdout.write(line); // Add this line
    // ... rest of handler
  });
}
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Predictive E2E Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  predictive-e2e:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
        
      - name: Install dependencies
        working-directory: backend
        run: npm ci
        
      - name: Run predictive E2E test
        working-directory: backend
        env:
          HARDHAT_FORK_URL: ${{ secrets.BASE_RPC_URL }}
        run: npm run predictive:e2e
```

## Architecture Notes

### Test Components

```
┌─────────────────────────────────────────────────────────────┐
│                    E2E Test Harness                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Base Fork    │  │ Mock Pyth    │  │ Backend      │      │
│  │ (anvil)      │  │ WebSocket    │  │ Process      │      │
│  │              │  │              │  │              │      │
│  │ Port: 8545   │  │ Port: 8999   │  │ Port: 3000   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                      Test Orchestration                      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Pyth Update:
   Mock Pyth → PythListener → PredictiveOrchestrator → RealTimeHFService
                                                              ↓
                                                      Micro-verify batch

2. Chainlink Confirmation:
   Block mine → Aave Oracle → ReserveDataUpdated → Reserve recheck
                                                           ↓
                                                   Profitability eval
```

## Related Documentation

- **Fork Testing Guide:** `scripts/fork/README.md`
- **Predictive Pipeline:** `docs/predictive-architecture.md` (if exists)
- **Pyth Integration:** Check PythListener source `src/services/PythListener.ts`
- **RealTimeHFService:** Check `src/services/RealTimeHFService.ts` for event handling

## Support

If you encounter issues not covered in troubleshooting:

1. Check backend logs for detailed error messages
2. Verify all prerequisites are installed and configured
3. Try running individual components manually:
   - Fork: `anvil --fork-url <BASE_RPC> --chain-id 8453`
   - Position: `npm run fork:setup`
   - Backend: `npm start` (with test env)
4. Review recent changes to predictive pipeline components
5. Open an issue with:
   - Test output (last 300 lines)
   - Environment details (Node version, OS, anvil version)
   - Configuration used (.env values, excluding secrets)
