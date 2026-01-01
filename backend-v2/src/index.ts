// index.ts: Main entry point for backend-v2

import { seedBorrowerUniverse } from './subgraph/universe.js';
import { ActiveRiskSet } from './risk/ActiveRiskSet.js';
import { HealthFactorChecker } from './risk/HealthFactorChecker.js';
import { PriceService } from './prices/PriceService.js';
import { RealtimeOrchestrator } from './realtime/RealtimeOrchestrator.js';
import { TelegramNotifier } from './notify/TelegramNotifier.js';
import { config } from './config/index.js';

/**
 * Main application entry point
 */
async function main() {
  console.log('[v2] ============================================');
  console.log('[v2] LiquidBot Backend V2 - PR1 Foundation');
  console.log('[v2] Base-only Aave V3 liquidation detection');
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

    // 3. Setup price service (Chainlink OCR2 + Pyth)
    console.log('[v2] Phase 3: Setting up price oracles');
    const priceService = new PriceService();
    
    // Add Chainlink feeds if configured
    if (config.CHAINLINK_FEEDS_JSON) {
      for (const [symbol, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_JSON)) {
        if (typeof feedAddress === 'string') {
          priceService.addChainlinkFeed(symbol, feedAddress);
        }
      }
    }
    
    console.log('[v2] Price service configured\n');

    // 4. Start real-time orchestration
    console.log('[v2] Phase 4: Starting real-time orchestration');
    const orchestrator = new RealtimeOrchestrator(riskSet, priceService);
    await orchestrator.start();
    
    console.log('[v2] Real-time monitoring active\n');

    // 5. Send startup notification
    await notifier.notifyStartup();

    console.log('[v2] ============================================');
    console.log('[v2] Backend V2 is running');
    console.log('[v2] Monitoring Base network for liquidations');
    console.log('[v2] Press Ctrl+C to stop');
    console.log('[v2] ============================================\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      await orchestrator.stop();
      await notifier.notify('🛑 *LiquidBot v2 Stopped*');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      await orchestrator.stop();
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
