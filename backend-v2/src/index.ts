// index.ts: Main entry point for backend-v2 (v2-realtime-pipeline-clean)

import { seedBorrowerUniverse } from './subgraph/universe.js';
import { ActiveRiskSet } from './risk/ActiveRiskSet.js';
import { HealthFactorChecker } from './risk/HealthFactorChecker.js';
import { ChainlinkListener } from './prices/ChainlinkListener.js';
import { TelegramNotifier } from './notify/TelegramNotifier.js';
import { config } from './config/index.js';
import { DirtyQueue } from './realtime/dirtyQueue.js';
import { AavePoolListeners } from './realtime/aavePoolListeners.js';
import { VerifierLoop } from './risk/verifierLoop.js';
import { ExecutorClient } from './execution/executorClient.js';
import { OneInchSwapBuilder } from './execution/oneInch.js';
import { AttemptHistory } from './execution/attemptHistory.js';
import { LiquidationAudit } from './audit/liquidationAudit.js';
import { initChainlinkFeeds, initChainlinkFeedsByAddress, initAddressToSymbolMapping, updateCachedPrice, cacheTokenDecimals, setChainlinkListener } from './prices/priceMath.js';
import { LiquidationPlanner } from './execution/liquidationPlanner.js';
import { ProtocolDataProvider } from './aave/protocolDataProvider.js';
import { metrics } from './metrics/metrics.js';

// 1inch swap slippage tolerance
// Should be adjusted based on market conditions and token pair liquidity
const SWAP_SLIPPAGE_BPS = 100; // 1% = 100 basis points

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
      riskSet.updateHF(result.address, result.healthFactor, result.debtUsd1e18);
      
      if (result.healthFactor < config.HF_THRESHOLD_START) {
        atRiskCount++;
        const debtUsdDisplay = Number(result.debtUsd1e18) / 1e18;
        console.log(
          `[v2] At-risk user: ${result.address} HF=${result.healthFactor.toFixed(4)} debtUsd=$${debtUsdDisplay.toFixed(2)}`
        );
      }
    }
    
    console.log(`[v2] Active risk set built: ${atRiskCount} at-risk users\n`);

    // 3. Setup protocol data caching and address→symbol mapping
    console.log('[v2] Phase 3: Building protocol data cache');
    const dataProvider = new ProtocolDataProvider(config.AAVE_PROTOCOL_DATA_PROVIDER);
    
    // Get all reserves and build address→symbol mapping
    const allReserves = await dataProvider.getAllReservesTokens();
    initAddressToSymbolMapping(allReserves);
    
    // Cache token decimals for all reserves
    for (const reserve of allReserves) {
      try {
        const decimals = await dataProvider.getReserveConfigurationData(reserve.tokenAddress);
        cacheTokenDecimals(reserve.tokenAddress, decimals.decimals);
      } catch (err) {
        console.warn(`[v2] Failed to cache decimals for ${reserve.symbol}:`, err instanceof Error ? err.message : err);
      }
    }
    
    console.log(`[v2] Protocol data cached: ${allReserves.length} reserves\n`);
    
    // 4. Setup price oracles (Chainlink only, Pyth disabled)
    console.log('[v2] Phase 4: Setting up price oracles');
    
    // Pyth is disabled in this version
    console.log('[v2] ⚠️  Pyth price feeds are DISABLED in this version');
    console.log('[v2] Using Chainlink feeds only for price data');
    
    const chainlinkListener = new ChainlinkListener();
    
    // Collect all unique feed addresses to subscribe
    const feedsToSubscribe = new Set<{ symbol: string; feedAddress: string }>();
    
    // Initialize priceMath with Chainlink feeds
    if (config.CHAINLINK_FEEDS_JSON) {
      initChainlinkFeeds(config.CHAINLINK_FEEDS_JSON);
      for (const [symbol, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_JSON)) {
        if (typeof feedAddress === 'string') {
          feedsToSubscribe.add({ symbol, feedAddress });
        }
      }
    }
    
    // Initialize address-to-feed mapping if provided (address-first pricing)
    if (config.CHAINLINK_FEEDS_BY_ADDRESS_JSON) {
      initChainlinkFeedsByAddress(config.CHAINLINK_FEEDS_BY_ADDRESS_JSON);
      console.log('[v2] Address-first pricing enabled');
      
      // Subscribe ALL address-mapped feeds for realtime updates
      for (const [tokenAddress, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_BY_ADDRESS_JSON)) {
        if (typeof feedAddress === 'string') {
          feedsToSubscribe.add({ 
            symbol: `addr:${tokenAddress}`, 
            feedAddress 
          });
        }
      }
    }
    
    // Subscribe all unique feeds to ChainlinkListener
    const uniqueFeeds = new Map<string, string>();
    for (const { symbol, feedAddress } of feedsToSubscribe) {
      uniqueFeeds.set(feedAddress.toLowerCase(), symbol);
    }
    
    console.log(`[v2] Subscribing ${uniqueFeeds.size} unique Chainlink feeds...`);
    for (const [feedAddress, symbol] of uniqueFeeds) {
      await chainlinkListener.addFeed(symbol, feedAddress);
    }
    
    // Register ChainlinkListener instance for cache-first lookups
    setChainlinkListener(chainlinkListener);
    
    // Wire ChainlinkListener to priceMath.updateCachedPrice()
    // Answer is already normalized to 1e18 by ChainlinkListener
    chainlinkListener.onPriceUpdate((update) => {
      updateCachedPrice(update.symbol, update.answer);
      console.log(`[v2] Price updated: ${update.symbol} = ${update.answer.toString()} (1e18)`);
    });
    
    // Start Chainlink listener
    await chainlinkListener.start();
    
    console.log('[v2] Price oracles configured (Chainlink only)\n');

    // 5. Setup realtime triggers and dirty queue
    console.log('[v2] Phase 5: Setting up realtime triggers');
    const dirtyQueue = new DirtyQueue();
    
    // Get active risk set as Set for listeners
    const activeRiskSetSet = new Set(
      Array.from(riskSet.getAll()).map(u => u.address.toLowerCase())
    );
    
    // Setup Aave Pool event listeners
    const aaveListeners = new AavePoolListeners(dirtyQueue, activeRiskSetSet);
    aaveListeners.start();
    
    console.log('[v2] Aave Pool listeners started\n');

    // 6. Setup execution components
    console.log('[v2] Phase 6: Setting up execution pipeline');
    
    // Prepare broadcast RPC URLs
    const broadcastRpcUrls = config.BROADCAST_RPC_URLS && config.BROADCAST_RPC_URLS.length > 0
      ? config.BROADCAST_RPC_URLS
      : [config.RPC_URL];
    
    const executorClient = new ExecutorClient(
      config.EXECUTOR_ADDRESS,
      config.EXECUTION_PRIVATE_KEY,
      broadcastRpcUrls
    );
    const oneInchBuilder = new OneInchSwapBuilder(8453); // Base chain ID
    const liquidationPlanner = new LiquidationPlanner(config.AAVE_PROTOCOL_DATA_PROVIDER);
    const attemptHistory = new AttemptHistory();
    
    console.log(`[v2] Executor client initialized (address=${executorClient.getAddress()})`);
    console.log(`[v2] Wallet address: ${executorClient.getWalletAddress()}`);
    console.log(`[v2] Broadcast RPCs: ${broadcastRpcUrls.length}`);
    console.log(`[v2] Liquidation planner initialized\n`);
    
    // Start metrics logging (every 60 seconds)
    metrics.startPeriodicLogging(60000);
    console.log('[v2] Performance metrics enabled\n');

    // 7. Setup liquidation audit
    console.log('[v2] Phase 7: Setting up liquidation audit');
    const liquidationAudit = new LiquidationAudit(
      activeRiskSetSet,
      riskSet,
      attemptHistory,
      notifier
    );
    liquidationAudit.start();
    console.log('[v2] Liquidation audit listener started\n');

    // 8. Start verifier loop with execution callback
    console.log('[v2] Phase 8: Starting verifier loop');
    
    const executionEnabled = config.EXECUTION_ENABLED;
    console.log(`[v2] Execution mode: ${executionEnabled ? 'ENABLED ⚠️' : 'DRY RUN (safe)'}`);
    
    const verifierLoop = new VerifierLoop(
      dirtyQueue,
      hfChecker,
      riskSet,
      {
        intervalMs: 250,
        batchSize: 200,
        onExecute: async (user: string, healthFactor: number, debtUsd1e18: bigint) => {
          const debtUsdDisplay = Number(debtUsd1e18) / 1e18;
          console.log(
            `[execute] Liquidation opportunity: user=${user} HF=${healthFactor.toFixed(4)} debtUsd=$${debtUsdDisplay.toFixed(2)}`
          );
          
          // Build liquidation plan with correct token units
          let plan;
          try {
            plan = await liquidationPlanner.buildPlan(user);
          } catch (err) {
            console.error(
              `[execute] Failed to build liquidation plan for ${user}:`,
              err instanceof Error ? err.message : err
            );
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'error',
              error: err instanceof Error ? err.message : String(err)
            });
            return;
          }
          
          if (!plan) {
            console.warn(`[execute] No liquidation plan available for user=${user}`);
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'skip_no_pair'
            });
            return;
          }
          
          console.log(
            `[execute] Plan: debtAsset=${plan.debtAsset} collateralAsset=${plan.collateralAsset}`
          );
          console.log(
            `[execute] debtToCover=${plan.debtToCover.toString()} (${plan.debtAssetDecimals} decimals)`
          );
          console.log(
            `[execute] expectedCollateralOut=${plan.expectedCollateralOut.toString()} (${plan.collateralAssetDecimals} decimals)`
          );
          console.log(
            `[execute] liquidationBonus=${plan.liquidationBonusBps} BPS (${plan.liquidationBonusBps / 100}%)`
          );
          
          if (!executionEnabled) {
            // DRY RUN mode: log only
            console.log('[execute] DRY RUN mode - would attempt liquidation with plan above');
            console.log(`[execute] Set EXECUTION_ENABLED=true to enable real execution`);
            
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'sent',
              debtAsset: plan.debtAsset,
              collateralAsset: plan.collateralAsset,
              debtToCover: plan.debtToCover.toString()
            });
            return;
          }
          
          // REAL EXECUTION PATH (guarded by EXECUTION_ENABLED)
          try {
            // Build 1inch swap calldata using expected collateral out
            const swapQuote = await oneInchBuilder.getSwapCalldata({
              fromToken: plan.collateralAsset,
              toToken: plan.debtAsset,
              amount: plan.expectedCollateralOut.toString(),
              fromAddress: executorClient.getAddress(),
              slippageBps: SWAP_SLIPPAGE_BPS
            });
            
            console.log(`[execute] 1inch swap quote obtained: minOut=${swapQuote.minOut}`);
            
            // Execute liquidation with correct amounts and safety checks
            const result = await executorClient.attemptLiquidation({
              user,
              collateralAsset: plan.collateralAsset,
              debtAsset: plan.debtAsset,
              debtToCover: plan.debtToCover,
              oneInchCalldata: swapQuote.data,
              minOut: BigInt(swapQuote.minOut),
              payout: executorClient.getWalletAddress(),
              expectedCollateralOut: plan.expectedCollateralOut
            });
            
            if (result.success) {
              console.log(`[execute] ✅ Liquidation successful! txHash=${result.txHash}`);
              attemptHistory.record({
                user,
                timestamp: Date.now(),
                status: 'included',
                txHash: result.txHash,
                debtAsset: plan.debtAsset,
                collateralAsset: plan.collateralAsset,
                debtToCover: plan.debtToCover.toString()
              });
            } else {
              console.error(`[execute] ❌ Liquidation failed: ${result.error}`);
              attemptHistory.record({
                user,
                timestamp: Date.now(),
                status: result.txHash ? 'reverted' : 'error',
                txHash: result.txHash,
                error: result.error,
                debtAsset: plan.debtAsset,
                collateralAsset: plan.collateralAsset,
                debtToCover: plan.debtToCover.toString()
              });
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[execute] ❌ Exception during liquidation: ${errorMsg}`);
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'error',
              error: errorMsg,
              debtAsset: plan.debtAsset,
              collateralAsset: plan.collateralAsset,
              debtToCover: plan.debtToCover.toString()
            });
          }
        }
      }
    );
    
    verifierLoop.start();
    console.log('[v2] Verifier loop started\n');

    // 9. Send startup notification
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
