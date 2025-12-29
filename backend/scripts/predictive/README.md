# Predictive Pipeline Scripts

This directory contains test and validation scripts for the predictive liquidation pipeline.

## Scripts

### e2e-pyth-chainlink.ts

End-to-end test harness that validates the complete predictive pipeline with Pyth (early warning) and Chainlink (oracle-of-record) integration.

**Usage:**
```bash
npm run predictive:e2e
```

**What it tests:**
- Pyth price updates trigger predictive orchestrator
- Predictive queue and micro-verify execution
- Chainlink confirmation triggers reserve rechecks
- Profitability evaluation logic

**Requirements:**
- Base mainnet RPC URL (for forking)
- Anvil (Foundry) for local fork
- Node.js 18.18.0+

**See also:** `../docs/predictive-e2e.md` for comprehensive documentation

## Directory Structure

```
predictive/
├── README.md                    # This file
└── e2e-pyth-chainlink.ts       # E2E test harness
```

## Related Files

- **Test utilities:** `../../test-utils/mock-pyth-ws.ts`, `../../test-utils/chainlink-impersonator.ts`
- **Position seeding:** `../fork/setup-scenario.ts`
- **Documentation:** `../../docs/predictive-e2e.md`

## Development

When adding new predictive pipeline tests:

1. Place them in this directory
2. Add NPM script in `package.json` with `predictive:` prefix
3. Document in this README
4. Update `docs/predictive-e2e.md` if applicable

## Troubleshooting

See `docs/predictive-e2e.md` for detailed troubleshooting guide.

Quick checks:
- Fork running? `curl -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'`
- Anvil installed? `anvil --version`
- Dependencies? `npm install`
