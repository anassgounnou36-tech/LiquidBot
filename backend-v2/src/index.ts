// index.ts: Main entry point for backend-v2 (v2-realtime-pipeline-clean)

import { seedBorrowerUniverse } from './subgraph/universe.js';
import { ActiveRiskSet } from './risk/ActiveRiskSet.js';
import { HealthFactorChecker } from './risk/HealthFactorChecker.js';
import { PriceService } from './prices/PriceService.js';
import { TelegramNotifier } from './notify/TelegramNotifier.js';
import { config } from './config/index.js';
import { DirtyQueue } from './realtime/dirtyQueue.js';
import { AavePoolListeners } from './realtime/aavePoolListeners.js';
import { VerifierLoop } from './risk/verifierLoop.js';
import { PairSelector } from './risk/pairSelector.js';
import { ExecutorClient } from './execution/executorClient.js';
import { OneInchSwapBuilder } from './execution/oneInch.js';
import { AttemptHistory } from './execution/attemptHistory.js';
import { LiquidationAudit } from './audit/liquidationAudit.js';
import { initChainlinkFeeds, initPythFeeds } from './prices/priceMath.js';

/**
 * Main application entry point
 */
async function main() {
  console.log('[v2] ============================================');
  console.log('[v2] LiquidBot Backend V2 - PR2 (clean)');
  console.log('[v2] v2-realtime-pipeline + execution + audit');
  console.log('[v2] Base-only Aave V3 liquidation bot');
  console.log('[v2] ============================================\n');

  // Initialize Telegram notifier
  const notifier = new TelegramNotifier();
  
  try {
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

    // 3. Setup price service (Chainlink OCR2 + Pyth) with priceMath
    console.log('[v2] Phase 3: Setting up price oracles');
    const priceService = new PriceService();
    
    // Initialize priceMath with Chainlink feeds
    if (config.CHAINLINK_FEEDS_JSON) {
      initChainlinkFeeds(config.CHAINLINK_FEEDS_JSON);
      for (const [symbol, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_JSON)) {
        if (typeof feedAddress === 'string') {
          priceService.addChainlinkFeed(symbol, feedAddress);
        }
      }
    }
    
    // Initialize priceMath with Pyth feeds
    if (config.PYTH_FEED_IDS_JSON) {
      initPythFeeds(config.PYTH_FEED_IDS_JSON);
    }
    
    console.log('[v2] Price service configured\n');

    // 4. Setup realtime triggers and dirty queue
    console.log('[v2] Phase 4: Setting up realtime triggers');
    const dirtyQueue = new DirtyQueue();
    
    // Get active risk set as Set for listeners
    const activeRiskSetSet = new Set(
      Array.from(riskSet.getAll()).map(u => u.address.toLowerCase())
    );
    
    // Setup Aave Pool event listeners
    const aaveListeners = new AavePoolListeners(dirtyQueue, activeRiskSetSet);
    aaveListeners.start();
    
    console.log('[v2] Aave Pool listeners started\n');

    // 5. Setup execution components
    console.log('[v2] Phase 5: Setting up execution pipeline');
    
    const executorClient = new ExecutorClient(
      config.EXECUTOR_ADDRESS,
      config.EXECUTION_PRIVATE_KEY
    );
    const oneInchBuilder = new OneInchSwapBuilder(8453); // Base chain ID
    const pairSelector = new PairSelector();
    const attemptHistory = new AttemptHistory();
    
    console.log(`[v2] Executor client initialized (address=${executorClient.getAddress()})`);
    console.log(`[v2] Wallet address: ${executorClient.getWalletAddress()}\n`);

    // 6. Setup liquidation audit
    console.log('[v2] Phase 6: Setting up liquidation audit');
    const liquidationAudit = new LiquidationAudit(
      activeRiskSetSet,
      attemptHistory,
      notifier
    );
    liquidationAudit.start();
    console.log('[v2] Liquidation audit listener started\n');

    // 7. Start verifier loop with execution callback
    console.log('[v2] Phase 7: Starting verifier loop');
    
    const verifierLoop = new VerifierLoop(
      dirtyQueue,
      hfChecker,
      riskSet,
      {
        intervalMs: 250,
        batchSize: 200,
        onExecute: async (user: string, healthFactor: number, debtUsd: number) => {
          console.log(
            `[execute] Attempting liquidation for user=${user} HF=${healthFactor.toFixed(4)} debtUsd=$${debtUsd.toFixed(2)}`
          );
          
          // Select collateral/debt pair
          const pair = await pairSelector.selectPair(user, executorClient.getWalletAddress());
          
          if (!pair) {
            console.warn(`[execute] No pair selected for user=${user}`);
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'skip_no_pair'
            });
            return;
          }
          
          // Get 1inch swap calldata
          // Note: Need to calculate expected collateral amount first
          // For now, skip actual execution if not properly configured
          console.log(
            `[execute] Pair selected: collateral=${pair.collateralAsset} debt=${pair.debtAsset}`
          );
          
          // Record attempt (simplified - full implementation would call executorClient)
          attemptHistory.record({
            user,
            timestamp: Date.now(),
            status: 'sent',
            debtAsset: pair.debtAsset,
            collateralAsset: pair.collateralAsset
          });
        }
      }
    );
    
    verifierLoop.start();
    console.log('[v2] Verifier loop started\n');

    // 8. Send startup notification
    await notifier.notifyStartup();

    console.log('[v2] ============================================');
    console.log('[v2] Backend V2 is running');
    console.log('[v2] Monitoring Base network for liquidations');
    console.log('[v2] Active risk set: ' + atRiskCount + ' users');
    console.log('[v2] Press Ctrl+C to stop');
    console.log('[v2] ============================================\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      verifierLoop.stop();
      aaveListeners.stop();
      liquidationAudit.stop();
      await notifier.notify('🛑 *LiquidBot v2 Stopped*');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      verifierLoop.stop();
      aaveListeners.stop();
      liquidationAudit.stop();
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
