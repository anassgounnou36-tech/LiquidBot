// index.ts: Main entry point for backend-v2
// PR2: Realtime pipeline + execution + audit

import { seedBorrowerUniverse } from './subgraph/universe.js';
import { ActiveRiskSet } from './risk/ActiveRiskSet.js';
import { HealthFactorChecker } from './risk/HealthFactorChecker.js';
import { getHttpProvider } from './providers/rpc.js';
import { getWsProvider } from './providers/ws.js';
import { DirtyQueue } from './realtime/dirtyQueue.js';
import { startAavePoolListeners } from './realtime/aavePoolListeners.js';
import { startVerifierLoop } from './risk/verifierLoop.js';
import { ChainlinkListener } from './prices/ChainlinkListener.js';
import { PythListener } from './prices/PythListener.js';
import { startLiquidationAudit } from './audit/liquidationAudit.js';
import { TelegramNotifier } from './notify/TelegramNotifier.js';
import { config } from './config/index.js';

/**
 * Main application entry point
 */
async function main() {
  console.log('[v2] ============================================');
  console.log('[v2] LiquidBot Backend V2 - PR2 Realtime Pipeline');
  console.log('[v2] Base-only Aave V3 liquidation detection + execution');
  console.log('[v2] ============================================\n');

  // Initialize Telegram notifier
  const notifier = new TelegramNotifier();
  
  try {
    // Initialize providers
    const http = getHttpProvider();
    const ws = getWsProvider();

    // 1. Seed borrower universe from subgraph
    console.log('[v2] Phase 1: Universe seeding from subgraph');
    const users = await seedBorrowerUniverse({
      maxCandidates: 10000,
      pageSize: 1000,
      politenessDelayMs: 100
    });
    
    console.log(`[v2] Universe seeded: ${users.length} users\n`);

    // 2. Build initial active risk set with on-chain HF checks
    console.log('[v2] Phase 2: Building active risk set');
    const riskSet = new ActiveRiskSet();
    riskSet.addBulk(users);
    
    const hfChecker = new HealthFactorChecker();
    console.log('[v2] Checking health factors for all users (this may take a while)...');
    
    const results = await hfChecker.checkBatch(users, 100);
    console.log(`[v2] Checked ${results.length} users`);
    
    // Update risk set with fresh HFs
    let atRiskCount = 0;
    for (const result of results) {
      riskSet.updateHF(result.address, result.healthFactor);
      
      if (result.healthFactor < config.HF_THRESHOLD_START) {
        atRiskCount++;
        console.log(
          `[v2] At-risk user: ${result.address} HF=${result.healthFactor.toFixed(4)}`
        );
      }
    }
    
    console.log(`[v2] Active risk set built: ${atRiskCount} at-risk users\n`);

    // 3. Initialize dirty queue and start realtime pipeline
    console.log('[v2] Phase 3: Starting realtime pipeline');
    const queue = new DirtyQueue();

    // Start Aave Pool event listeners (mark users dirty on events)
    startAavePoolListeners(ws, config.AAVE_POOL_ADDRESS, (user) => {
      queue.markDirty(user);
    });

    // Start Chainlink price listeners (mark all active users dirty on price updates)
    if (config.CHAINLINK_FEEDS_JSON) {
      const chainlinkListener = new ChainlinkListener();
      
      for (const [symbol, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_JSON)) {
        if (typeof feedAddress === 'string') {
          chainlinkListener.addFeed(symbol, feedAddress);
        }
      }

      chainlinkListener.onPriceUpdate(() => {
        // Mark all active users dirty (bounded by verifier loop batch cap)
        for (const candidate of riskSet.getAll()) {
          queue.markDirty(candidate.address);
        }
      });

      await chainlinkListener.start();
      console.log('[v2] Chainlink listeners started');
    }

    // Start Pyth price listener
    const pythListener = new PythListener();
    
    pythListener.onPriceUpdate(() => {
      // Mark all active users dirty on price updates
      for (const candidate of riskSet.getAll()) {
        queue.markDirty(candidate.address);
      }
    });

    pythListener.start();
    console.log('[v2] Pyth listener started\n');

    // 4. Start HF verifier loop
    console.log('[v2] Phase 4: Starting HF verifier loop');
    startVerifierLoop({
      http,
      aavePool: config.AAVE_POOL_ADDRESS,
      queue,
      minDebtUsd: config.MIN_DEBT_USD,
      hfExecute: config.HF_THRESHOLD_EXECUTE,
      batchCap: 200,
      blockTagMode: 'latest'
    });
    console.log('[v2] Verifier loop started\n');

    // 5. Start liquidation audit service
    console.log('[v2] Phase 5: Starting liquidation audit');
    startLiquidationAudit(ws, config.AAVE_POOL_ADDRESS);
    console.log('[v2] Liquidation audit started\n');

    // 6. Send startup notification
    await notifier.notify('🤖 *LiquidBot v2 PR2 Started*\n\nRealtime pipeline + execution + audit active');

    console.log('[v2] ============================================');
    console.log('[v2] Backend V2 PR2 is running');
    console.log('[v2] Monitoring Base network for liquidations');
    console.log(`[v2] Active set size: ${riskSet.size()}`);
    console.log('[v2] Press Ctrl+C to stop');
    console.log('[v2] ============================================\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      pythListener.stop();
      await notifier.notify('🛑 *LiquidBot v2 Stopped*');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      pythListener.stop();
      await notifier.notify('🛑 *LiquidBot v2 Stopped*');
      process.exit(0);
    });

  } catch (err) {
    console.error('[v2] Fatal error:', err);
    await notifier.notifyError(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Run the application
main().catch(err => {
  console.error('[v2] Unhandled error:', err);
  process.exit(1);
});
