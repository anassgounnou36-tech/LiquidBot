# Hardhat Fork Test (Base / Aave v3)

## Overview
This guide demonstrates how to test LiquidBot against a local Hardhat fork of Base mainnet with seeded near-threshold Aave v3 positions. This enables safe testing of predictive and price-trigger features without executing on mainnet.

## Prerequisites

### 1. Environment Configuration
Create or update your `.env` file with the following settings:

```bash
# Hardhat Fork Configuration
HARDHAT_FORK_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
# Optional: pin to specific block for reproducibility
HARDHAT_FORK_BLOCK=40000000

# Point all bot RPCs to local Hardhat node
RPC_URL=http://127.0.0.1:8545
WS_RPC_URL=ws://127.0.0.1:8545
CHAINLINK_RPC_URL=http://127.0.0.1:8545
BACKFILL_RPC_URL=http://127.0.0.1:8545

# Safety settings for testing
USE_FLASHBLOCKS=false
EXECUTE=false

# Test wallet (use one of Hardhat's default accounts)
FORK_TEST_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Optional: Customize test scenario
FORK_TEST_ETH_DEPOSIT=1.0           # ETH to deposit as collateral
FORK_TEST_TARGET_HF_BPS=10200       # Initial HF target (1.02)
FORK_TEST_SECOND_BORROW_BPS=10080   # Optional second borrow for tighter HF (1.008)

# Enable features for testing
PYTH_ENABLED=true
PRICE_TRIGGER_ENABLED=true
PREDICTIVE_ENABLED=true
```

**Important**: Leave `SECONDARY_HEAD_RPC_URL` empty when testing with the fork.

### 2. Hardhat Default Test Accounts
Hardhat provides 20 funded accounts. The first account (shown above) has 10,000 ETH. You can use any of these:
- Account #0: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- See [Hardhat documentation](https://hardhat.org/hardhat-network/docs/reference#accounts) for more

## Setup Steps

### 1. Start the Hardhat Fork
In a terminal, start the Hardhat node:
```bash
npm run hardhat:node
# or
npx hardhat node
```

The node will fork Base mainnet and expose RPC endpoints:
- HTTP: `http://127.0.0.1:8545`
- WebSocket: `ws://127.0.0.1:8545`

### 2. Seed Near-Threshold Position
In a second terminal, run the fork setup script:
```bash
npm run fork:setup
# or
npx ts-node backend/scripts/fork/setup-scenario.ts
```

This script will:
1. Wrap ETH → WETH via `deposit()`
2. Approve and supply WETH as collateral to Aave v3 Pool
3. Read Aave Oracle prices and liquidation threshold
4. Compute USDC borrow amount for target Health Factor (~1.02)
5. Execute initial borrow
6. (Optional) Execute second borrow to tighten HF further (~1.008)

Expected output:
```
Using test wallet: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

[1/6] Wrapping ETH -> WETH: 1.0 ETH
WETH balance: 1.0

[2/6] Approving Aave Pool for WETH...
Supplying WETH to Aave v3 Pool...

[3/6] Reading Aave Oracle prices (1e8) and WETH liquidationThreshold (bps)...
WETH=3200.00 USD (1e8), USDC=1.00 USD (1e8), LTbps=8000

[4/6] Computing initial USDC borrow for target HF bps: 10200
Borrowing ~2509803921 USDC (6d)
USDC balance after initial borrow: 2509803921

[5/6] Performing optional second borrow to tighten HF, target bps: 10080
Second borrow delta: 29761904 USDC (6d)
USDC balance after second borrow: 2539565825

[6/6] Setup complete.
Next steps:
  • Start bot with PYTH_ENABLED=true and all RPCs pointing to http://127.0.0.1:8545
  • Ensure USE_FLASHBLOCKS=false and EXECUTE=false for safe testing
  • Watch /metrics for predictive/price-trigger counters and min HF movements
```

### 3. Run the Bot
In a third terminal, start the bot:
```bash
cd backend && npm run dev
```

The bot will:
- Connect to the local Hardhat fork
- Detect the seeded near-threshold position
- Process real-time events and price updates
- Execute predictive evaluations
- Log opportunities without executing (since `EXECUTE=false`)

## Monitoring & Validation

### Metrics Endpoint
Monitor bot activity via Prometheus metrics:
```bash
curl http://localhost:3000/metrics
```

Key metrics to watch:
- `liquidbot_realtime_min_health_factor` - Should show HF ~1.005-1.02
- `liquidbot_realtime_price_triggers_total{asset="WETH"}` - Price trigger activations
- `liquidbot_predictive_ticks_executed_total` - Predictive evaluations
- `liquidbot_predictive_micro_verify_scheduled_total` - Micro-verification calls

### Logs
Watch bot logs for:
- Position discovery: `Candidate added` or `Health factor detected`
- Predictive evaluations: `Predictive projection` or `ETA to liquidation`
- Price triggers: `Price drop detected` or `Emergency scan triggered`
- Opportunity detection: `Liquidation opportunity` (even with EXECUTE=false)

## Advanced Testing

### Simulating Price Movements
To test price-trigger logic, you can manipulate prices on the fork by:
1. Impersonating Chainlink aggregator contracts
2. Calling `updateAnswer()` with modified prices
3. Observing bot response to price drops

### Testing Different Health Factor Thresholds
Adjust the scenario by modifying env vars:
```bash
# More conservative (safer, HF = 1.10)
FORK_TEST_TARGET_HF_BPS=11000

# Very tight (risky, HF = 1.005)
FORK_TEST_TARGET_HF_BPS=10050
```

### Multiple Positions
Run the setup script multiple times with different `FORK_TEST_PK` values to create multiple at-risk positions.

## Cleanup
1. Stop the bot (Ctrl+C)
2. Stop the Hardhat node (Ctrl+C)
3. Restart the Hardhat node to reset the fork state

## Troubleshooting

### "FORK_TEST_PK is required"
Ensure `FORK_TEST_PK` or `TEST_PK` is set in your `.env` file.

### "execution reverted: SafeERC20: low-level call failed"
The fork URL might be incorrect or blocked. Verify `HARDHAT_FORK_URL` points to a valid Base RPC endpoint.

### Bot not detecting position
- Check RPC URLs in `.env` - all should point to `http://127.0.0.1:8545`
- Verify Hardhat node is running on port 8545
- Confirm `USE_REALTIME_HF=true` in `.env`

### "Cannot find module 'ethers'"
Run `npm install` in the root directory to install dependencies.

## Notes
- This is a dev-only workflow; no runtime code changes to the bot are required
- The fork resets to mainnet state on each restart
- Gas costs are zero on the fork
- Pyth WebSocket still connects to live Hermes (not forked)
- To tighten HF further, set `FORK_TEST_SECOND_BORROW_BPS` (e.g., 10080 ≈ 1.008)

