# Fork Test Scripts

This directory contains scripts for testing the LiquidBot against a local Hardhat fork of Base mainnet.

## setup-scenario.ts

Seeds a near-threshold Aave v3 borrower position on a local Hardhat fork for testing the bot's predictive and price-trigger capabilities.

### Environment Variables

Required:
- `FORK_TEST_PK` or `TEST_PK`: Private key for the test account (use one of Hardhat's default funded accounts)
- `RPC_URL`: Local Hardhat node URL (default: http://127.0.0.1:8545)

Optional:
- `FORK_TEST_ETH_DEPOSIT`: Amount of ETH to wrap into WETH (default: 1.0)
- `FORK_TEST_TARGET_HF_BPS`: Target health factor in basis points for first borrow (default: 10200 = 1.02)
- `FORK_TEST_SECOND_BORROW_BPS`: Target health factor for optional second borrow (e.g., 10080 = 1.008)

Contract addresses (with Base mainnet defaults):
- `WETH_ADDRESS`: 0x4200000000000000000000000000000000000006
- `USDC_ADDRESS`: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
- `AAVE_POOL`: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
- `AAVE_ORACLE`: 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
- `AAVE_PROTOCOL_DATA_PROVIDER`: 0xC4Fcf9893072d61Cc2899C0054877Cb752587981

### Usage

See [docs/fork-test-hardhat.md](../../../docs/fork-test-hardhat.md) for complete usage instructions.
