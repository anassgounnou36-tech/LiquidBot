# Test Utilities

Shared test utilities for backend testing, particularly for fork-based and E2E tests.

## Utilities

### mock-pyth-ws.ts

Mock Pyth Network WebSocket server for testing Pyth integration.

**Features:**
- Mimics Pyth Hermes WebSocket API message format
- Accepts subscription requests from `PythListener`
- Allows programmatic price update injection
- Tracks connected clients and subscriptions

**Usage:**
```typescript
import { MockPythServer, PYTH_FEED_IDS } from './test-utils/mock-pyth-ws.js';

const server = new MockPythServer(8999);
await server.start();

// Send price update
server.sendPriceUpdate('WETH', 3000.50);

await server.stop();
```

**Message Format:**
- Subscription: `{ type: 'subscribe', ids: ['0x...'] }`
- Price Update: `{ type: 'price_update', price_feed: { id, price: { price, conf, expo }, publish_time } }`

### chainlink-impersonator.ts

Utilities for simulating Chainlink oracle behavior on forked networks.

**Features:**
- Register Chainlink price feeds
- Impersonate aggregator transmitters (anvil/hardhat)
- Emit NewTransmission events (complex, see notes)
- Mine blocks to trigger updates
- Extract feed addresses from logs

**Usage:**
```typescript
import { ChainlinkImpersonator } from './test-utils/chainlink-impersonator.js';

const impersonator = new ChainlinkImpersonator('http://127.0.0.1:8545');

// Register feed
await impersonator.registerFeed('WETH', '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70');

// Update price (attempts NewTransmission emission)
await impersonator.emitNewTransmission('WETH', 3100.00);

// Simpler: mine blocks to trigger natural updates
await impersonator.mineBlocks(5);
```

**Notes:**
- `emitNewTransmission()` requires complex OCR signatures and may not work fully
- For most tests, block mining + Aave oracle updates are sufficient
- See `docs/predictive-e2e.md` for alternative approaches

## Helper Functions

### mock-pyth-ws.ts

- `calculateNewPrice(basePrice, deltaPct)` - Calculate price with percentage change
- `PYTH_FEED_IDS` - Map of symbol to Pyth feed ID

### chainlink-impersonator.ts

- `extractFeedAddressFromLogs(logs, symbol)` - Parse feed address from backend logs

## Testing Best Practices

1. **Fork-based tests:**
   - Start fork before test (or check if running)
   - Use fresh accounts (Hardhat defaults or custom)
   - Clean up resources (stop servers, kill processes)

2. **Mock servers:**
   - Use high port numbers (8999+) to avoid conflicts
   - Check if port is available before starting
   - Handle WebSocket lifecycle (connect, disconnect, error)

3. **Process spawning:**
   - Collect stdout/stderr for assertions
   - Set proper timeouts
   - Kill child processes on test exit

4. **Log assertions:**
   - Look for specific patterns in logs
   - Allow some timing variance (increase wait times if needed)
   - Collect sufficient log history (100-300 lines)

## Windows Compatibility

All utilities use Node.js built-ins (`path.join`, `spawn`) which are cross-platform.

**Path handling:**
```typescript
// ✓ Correct - works on Windows & Unix
import { join } from 'path';
const scriptPath = join(process.cwd(), 'scripts', 'fork', 'setup-scenario.ts');

// ✗ Incorrect - Unix only
const scriptPath = process.cwd() + '/scripts/fork/setup-scenario.ts';
```

**Process spawning:**
```typescript
// ✓ Correct - tsx is a Node module, works everywhere
const proc = spawn('tsx', ['script.ts']);

// ✓ Correct - npm scripts work cross-platform
const proc = spawn('npm', ['start']);

// ✗ Incorrect - shell-specific
const proc = spawn('bash', ['-c', 'tsx script.ts']);
```

## Related Documentation

- **E2E Test Guide:** `../docs/predictive-e2e.md`
- **Fork Testing:** `../scripts/fork/README.md`
- **PythListener:** `../src/services/PythListener.ts` (implementation reference)

## Contributing

When adding new test utilities:

1. Place in this directory
2. Export clean public API
3. Add JSDoc comments
4. Document in this README
5. Add usage examples
6. Consider Windows compatibility

## Dependencies

Test utilities use:
- `ws` - WebSocket client/server
- `ethers` - Ethereum interactions
- Node built-ins (`child_process`, `fs`, `path`)

No additional test-specific dependencies required.
