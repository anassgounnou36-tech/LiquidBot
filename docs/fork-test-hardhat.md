# Hardhat Fork Test (Base / Aave v3)

## Prerequisites
- .env:
  - HARDHAT_FORK_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
  - (optional) HARDHAT_FORK_BLOCK=40000000  # for reproducible forks
  - RPC_URL=http://127.0.0.1:8545
  - WS_RPC_URL=ws://127.0.0.1:8545
  - USE_FLASHBLOCKS=false
  - EXECUTE=false
  - FORK_TEST_PK=0x<one of Hardhat's funded private keys>
  - Optional:
    - FORK_TEST_ETH_DEPOSIT=1.0
    - FORK_TEST_TARGET_HF_BPS=10200
    - FORK_TEST_SECOND_BORROW_BPS=10080

- Point ALL read RPCs to the fork for the bot:
  - CHAINLINK_RPC_URL=http://127.0.0.1:8545
  - BACKFILL_RPC_URL=http://127.0.0.1:8545
  - (leave SECONDARY_HEAD_RPC_URL empty)

## Steps
1. Start the Hardhat fork:
   ```bash
   npx hardhat node
   ```
2. Seed a near-threshold borrower on the fork:
   ```bash
   npx ts-node backend/scripts/fork/setup-scenario.ts
   ```
3. Run the bot against the fork:
   - Ensure:
     - PYTH_ENABLED=true (Pyth WS will still connect to Hermes)
     - PRICE_TRIGGER_ENABLED=true (if you want price-trigger counters)
     - RPC_URL/WS_RPC_URL/CHAINLINK_RPC_URL/BACKFILL_RPC_URL all point to http://127.0.0.1:8545
     - USE_FLASHBLOCKS=false, EXECUTE=false

## Validate via metrics
- curl http://localhost:3000/metrics and monitor:
  - liquidbot_realtime_min_health_factor
  - liquidbot_realtime_price_triggers_total{asset="WETH"}
  - liquidbot_predictive_ticks_executed_total
  - liquidbot_predictive_micro_verify_scheduled_total

## Notes
- This is a dev-only workflow; no changes to the bot runtime are required.
- To tighten HF further, set FORK_TEST_SECOND_BORROW_BPS (e.g., 10080 ≈ 1.008) before running the script.
