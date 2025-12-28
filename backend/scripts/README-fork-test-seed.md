# Fork Test Seed Position Script

## Overview

This script seeds a near-threshold Aave v3 position on Base in a local fork for testing the liquidation bot's predictive capabilities. It creates a position with a Health Factor of approximately 1.02, which is just above the liquidation threshold.

## Purpose

The script enables you to:
- Test the bot's predictive path using real Pyth WebSocket updates
- Validate bot behavior with a local forked chain
- Create reproducible test scenarios for development

## Prerequisites

1. **Node.js & Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Local Fork**
   Start a local Base fork using Anvil (Foundry):
   ```bash
   anvil --fork-url https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY \
         --chain-id 8453 \
         --block-time 2 \
         --port 8545
   ```

   Alternatively, use Hardhat:
   ```bash
   npx hardhat node --fork https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
   ```

## Configuration

Create or update your `.env` file in the `backend` directory:

```bash
# Local fork RPC endpoint
RPC_URL=http://127.0.0.1:8545
WS_RPC_URL=ws://127.0.0.1:8545

# Disable flashblocks for local testing
USE_FLASHBLOCKS=false

# Test private key (Anvil default key #0 - pre-funded with 10000 ETH)
FORK_TEST_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**⚠️ Security Note**: The private key shown above is the Anvil default test key and should **NEVER** be used on mainnet. It's only for local testing.

## Usage

Run the script:

```bash
# From the backend directory
npm run fork:seed

# Or directly with tsx
tsx scripts/fork-test-seed-position.ts
```

## What the Script Does

The script performs the following steps:

1. **Wrap ETH → WETH**
   - Deposits 1 ETH into the WETH9 contract
   - Converts native ETH to ERC-20 WETH

2. **Approve Aave Pool**
   - Grants approval to Aave v3 Pool to spend WETH

3. **Supply Collateral**
   - Supplies WETH as collateral to Aave

4. **Query Prices**
   - Fetches WETH price from Aave Oracle (1e8 base units)
   - Fetches USDC price from Aave Oracle (1e8 base units)

5. **Get Reserve Configuration**
   - Queries WETH liquidation threshold from Protocol Data Provider
   - Retrieves other reserve parameters (LTV, liquidation bonus, etc.)

6. **Calculate Borrow Amount**
   - Computes USDC borrow amount targeting Health Factor ≈ 1.02
   - Formula: `debt = (collateral × liquidationThreshold) / 1.02`

7. **Borrow USDC**
   - Executes variable rate borrow (interestRateMode=2)
   - Creates a position just above liquidation threshold

8. **Verify Position**
   - Queries final account data
   - Displays Health Factor and position summary

## Expected Output

```
════════════════════════════════════════════════════════════════════════════════
Fork Test: Seed Near-Threshold Aave v3 Position
════════════════════════════════════════════════════════════════════════════════

✓ RPC URL: http://127.0.0.1:8545

👤 User Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
💰 Initial ETH Balance: 10000.0 ETH

────────────────────────────────────────────────────────────────────────────────
Step 1: Wrap ETH → WETH
────────────────────────────────────────────────────────────────────────────────
Wrapping: 1.0 ETH → WETH
✓ Transaction: 0x...
✓ WETH Balance: 1.000000 WETH

[... more steps ...]

────────────────────────────────────────────────────────────────────────────────
Step 8: Verify Final Position
────────────────────────────────────────────────────────────────────────────────
Total Collateral (base): 3500.000000 USD
Total Debt (base): 2828.571428 USD
Health Factor: 1.020000

════════════════════════════════════════════════════════════════════════════════
✅ Position Successfully Created!
════════════════════════════════════════════════════════════════════════════════

Summary:
  User Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Collateral: 1.000000 WETH
  Debt: 2828.571428 USDC
  Health Factor: 1.020000

The bot can now detect this position via on-chain queries.
Monitor with Pyth WS updates while bot reads from fork at: http://127.0.0.1:8545
```

## Testing with the Bot

After running this script:

1. **Start the bot** with the same `.env` configuration
2. The bot will detect the seeded position via on-chain queries
3. Monitor bot logs for predictive warnings as the position approaches liquidation
4. Test Pyth WebSocket updates by manually moving prices (if supported by your fork)

## Aave v3 Addresses (Base Mainnet)

The script uses these mainnet addresses (automatically forked):

- **Aave Pool**: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- **Protocol Data Provider**: `0xC4Fcf9893072d61Cc2899C0054877Cb752587981`
- **Aave Oracle**: `0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156`
- **WETH**: `0x4200000000000000000000000000000000000006`
- **USDC**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Troubleshooting

### Error: "Insufficient ETH balance"
- Ensure you're using a funded test key
- Anvil's default keys come pre-funded with 10000 ETH each

### Error: "RPC_URL not set"
- Verify your `.env` file exists in the `backend` directory
- Check that `RPC_URL` is set to your local fork endpoint

### Error: "Transaction reverted"
- Ensure your local fork is running and responsive
- Check that you're forking from a recent Base mainnet block
- Verify the fork has the correct chain ID (8453)

### Health Factor not exactly 1.02
- Small variations are normal due to:
  - Integer division in smart contracts
  - Oracle price precision
  - Variable borrow index changes
- Expected range: 1.015 - 1.025

## Notes

- This is a **standalone helper script** and does not modify bot runtime
- Use this to create test positions before running the bot in fork mode
- The created position will be visible to the bot via on-chain queries
- All transactions are executed on the local fork, not mainnet
- The script is idempotent - you can run it multiple times with different test keys

## See Also

- [Backend Operations Guide](../OPERATIONS.md)
- [Quick Start Guide](../../QUICKSTART.md)
- [Aave v3 Documentation](https://docs.aave.com/developers/core-contracts/pool)
