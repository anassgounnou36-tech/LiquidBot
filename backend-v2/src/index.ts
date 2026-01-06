// index.ts: Main entry point for backend-v2 (v2-realtime-pipeline-clean)

import { seedBorrowerUniverse, DEFAULT_UNIVERSE_MAX_CANDIDATES } from './subgraph/universe.js';
import { ActiveRiskSet } from './risk/ActiveRiskSet.js';
import { HealthFactorChecker } from './risk/HealthFactorChecker.js';
import { ChainlinkListener } from './prices/ChainlinkListener.js';
import { PythListener } from './prices/PythListener.js';
import { TelegramNotifier } from './notify/TelegramNotifier.js';
import { config } from './config/index.js';
import { DirtyQueue } from './realtime/dirtyQueue.js';
import { AavePoolListeners } from './realtime/aavePoolListeners.js';
import { VerifierLoop } from './risk/verifierLoop.js';
import { ExecutorClient } from './execution/executorClient.js';
import { OneInchSwapBuilder } from './execution/oneInch.js';
import { AttemptHistory } from './execution/attemptHistory.js';
import { LiquidationAudit } from './audit/liquidationAudit.js';
import { initChainlinkFeeds, initChainlinkFeedsByAddress, initAddressToSymbolMapping, updateCachedPrice, cacheTokenDecimals, setChainlinkListener, resolveEthUsdFeedAddress, getNormalizedPriceFromFeed } from './prices/priceMath.js';
import { LiquidationPlanner } from './execution/liquidationPlanner.js';
import { ProtocolDataProvider } from './aave/protocolDataProvider.js';
import { metrics } from './metrics/metrics.js';
import { computeNetDebtToken } from './execution/safety.js';
import { logHeartbeat } from './metrics/blockHeartbeat.js';
import { getWsProvider } from './providers/ws.js';
import { UserIndex } from './predictive/UserIndex.js';
import { PredictiveLoop } from './predictive/PredictiveLoop.js';

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
    // Startup cap audit
    console.log('[v2] ============================================');
    console.log('[v2] CAPACITY AUDIT');
    console.log('[v2] ============================================');
    console.log(`[v2] Universe seeding cap: ${config.UNIVERSE_MAX_CANDIDATES || DEFAULT_UNIVERSE_MAX_CANDIDATES} (source: ${config.UNIVERSE_MAX_CANDIDATES ? 'UNIVERSE_MAX_CANDIDATES' : 'default'})`);
    console.log(`[v2] DirtyQueue cap: unbounded (Set-based)`);
    console.log(`[v2] VerifierLoop batch size: 200`);
    console.log(`[v2] ActiveRiskSet cap: unbounded (Map-based)`);
    console.log(`[v2] MIN_DEBT_USD filter: $${config.MIN_DEBT_USD}`);
    console.log(`[v2] Price cache TTL: ${config.PRICE_CACHE_TTL_MS}ms`);
    console.log('[v2] ============================================\n');
    
    // 1. Seed borrower universe from subgraph
    console.log('[v2] Phase 1: Universe seeding from subgraph');
    const users = await seedBorrowerUniverse({
      maxCandidates: config.UNIVERSE_MAX_CANDIDATES,
      pageSize: config.UNIVERSE_PAGE_SIZE ?? 1000,
      politenessDelayMs: config.UNIVERSE_POLITENESS_DELAY_MS ?? 100
    });
    
    console.log(`[v2] Universe seeded: ${users.length} users\n`);

    // 2. Setup protocol data caching and address→symbol mapping
    console.log('[v2] Phase 2: Building protocol data cache');
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
    
    // 3. Setup price oracles (Chainlink only, Pyth disabled)
    console.log('[v2] Phase 3: Setting up price oracles');
    
    // Pyth is disabled in this version
    console.log('[v2] ⚠️  Pyth price feeds are DISABLED in this version');
    console.log('[v2] Using Chainlink feeds only for price data');
    
    // PREDICTIVE LIQUIDATION: Enable Pyth listener for predictive pipeline
    console.log('[v2] 🔮 Enabling Pyth for predictive liquidation pipeline');
    const pythListener = new PythListener();
    
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
    
    console.log('[v2] Price oracles configured (Chainlink only)');
    
    // Wire Pyth listener to priceMath.updateCachedPrice()
    pythListener.onPriceUpdate((update) => {
      // Normalize Pyth price to 1e18 BigInt for cache
      const price1e18 = BigInt(Math.floor(update.price * 1e18));
      updateCachedPrice(update.symbol, price1e18);
      console.log(`[v2] Pyth price updated: ${update.symbol} = $${update.price.toFixed(2)}`);
    });
    
    // Start Pyth listener
    await pythListener.start();
    console.log('[v2] Pyth listener started for predictive pipeline');
    
    // Ensure ETH/WETH price is ready before Phase 4 scan to avoid cache misses
    console.log('[v2] Ensuring ETH/WETH price readiness...');
    const ethFeedAddress = resolveEthUsdFeedAddress();
    if (!ethFeedAddress) {
      throw new Error(
        'Fatal: No ETH/WETH Chainlink feed configured. ' +
        'Please set CHAINLINK_FEEDS_JSON with ETH or WETH feed address.'
      );
    }
    
    // Check if ETH price is already cached from warmup
    let ethPrice = chainlinkListener.getCachedPrice(ethFeedAddress);
    
    if (ethPrice === null) {
      // Cache miss - fetch once via RPC to ensure deterministic readiness
      console.log('[v2] ETH cache miss after warmup, fetching via RPC...');
      try {
        ethPrice = await getNormalizedPriceFromFeed(ethFeedAddress);
        updateCachedPrice('ETH', ethPrice);
        updateCachedPrice('WETH', ethPrice); // Also cache as WETH for aliasing
        console.log(`[v2] ETH/WETH price fetched: ${ethPrice.toString()} (1e18)`);
      } catch (err) {
        throw new Error(
          `Fatal: Failed to fetch ETH/WETH price from feed ${ethFeedAddress}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else {
      // Cache hit - ETH already warmed from listener
      updateCachedPrice('ETH', ethPrice);
      updateCachedPrice('WETH', ethPrice); // Also cache as WETH for aliasing
      console.log(`[v2] ETH/WETH price ready from cache: ${ethPrice.toString()} (1e18)`);
    }
    
    console.log('[v2] ETH/WETH price readiness confirmed\n');

    // 4. Build initial active risk set with on-chain HF checks
    console.log('[v2] Phase 4: Building active risk set');
    const riskSet = new ActiveRiskSet();
    
    // Build UserIndex for predictive liquidation
    const userIndex = new UserIndex();
    riskSet.setUserIndex(userIndex);
    console.log('[v2] UserIndex initialized and wired to ActiveRiskSet');
    
    riskSet.addBulk(users);
    
    const hfChecker = new HealthFactorChecker();
    console.log('[v2] Checking health factors for all users (this may take a while)...');
    
    const results = await hfChecker.checkBatch(users, 100);
    console.log(`[v2] Checked ${results.length} users`);
    
    // Compute minimum debt threshold once (same as ActiveRiskSet uses)
    const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
    
    // Update risk set with fresh HFs
    let dustLiquidatableCount = 0;
    
    for (const result of results) {
      riskSet.updateHF(result.address, result.healthFactor, result.debtUsd1e18);
      
      // Log watched/actionable users (HF < threshold AND debt >= MIN_DEBT_USD)
      if (result.healthFactor < config.HF_THRESHOLD_START && result.debtUsd1e18 >= minDebtUsd1e18) {
        const debtUsdDisplay = Number(result.debtUsd1e18) / 1e18;
        console.log(
          `[v2] Watched user: ${result.address} HF=${result.healthFactor.toFixed(4)} debtUsd=$${debtUsdDisplay.toFixed(2)}`
        );
      }
      
      // Optional: Log dust liquidatable users (HF < 1.0 but debt < MIN_DEBT_USD)
      if (config.LOG_DUST_LIQUIDATABLE && result.healthFactor < 1.0 && result.debtUsd1e18 < minDebtUsd1e18) {
        dustLiquidatableCount++;
        const debtUsdDisplay = Number(result.debtUsd1e18) / 1e18;
        console.log(
          `[v2][dust-liq] user=${result.address} HF=${result.healthFactor.toFixed(4)} debtUsd=$${debtUsdDisplay.toFixed(2)} (excluded by MIN_DEBT_USD=${config.MIN_DEBT_USD})`
        );
      }
    }
    
    // Derive final counts from actual risk set (not manual counters)
    const actualWatched = riskSet.getBelowThreshold();
    const totalStored = riskSet.size();
    
    // Find min HF among all stored users
    let minHF: number | null = null;
    for (const user of riskSet.getAll()) {
      if (user.healthFactor < Infinity) {
        if (minHF === null || user.healthFactor < minHF) {
          minHF = user.healthFactor;
        }
      }
    }
    
    console.log(
      `[v2] Active risk set built: scanned=${results.length} stored=${totalStored} watched=${actualWatched.length} (minDebt>=$${config.MIN_DEBT_USD})` +
      (config.LOG_DUST_LIQUIDATABLE ? ` dustLiquidatable=${dustLiquidatableCount}` : ' (dust log disabled)') +
      (minHF !== null ? ` minHF=${minHF.toFixed(4)}` : '')
    );
    
    // Log UserIndex statistics
    const indexStats = userIndex.getStats();
    console.log(`[predict] userIndex built: tokens=${indexStats.tokenCount} users=${indexStats.userCount}`);
    console.log();

    // 4a. Setup PredictiveLoop for Pyth-driven rescoring
    console.log('[v2] Phase 4a: Setting up predictive liquidation loop');
    const predictiveLoop = new PredictiveLoop(
      pythListener,
      userIndex,
      hfChecker,
      riskSet
    );
    predictiveLoop.start();
    console.log('[v2] PredictiveLoop started\n');

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
          
          // Check if user has a pending attempt - skip if so
          if (attemptHistory.hasPending(user)) {
            console.log(`[execute] Skipping user ${user} - pending attempt exists`);
            metrics.incrementPendingSkippedRechecks();
            return;
          }
          
          // Build candidate plans (up to 3)
          let candidates;
          try {
            candidates = await liquidationPlanner.buildCandidatePlans(user);
          } catch (err) {
            console.error(
              `[execute] Failed to build liquidation plans for ${user}:`,
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
          
          if (!candidates || candidates.length === 0) {
            console.warn(`[execute] No liquidation plans available for user=${user}`);
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'skip_no_pair'
            });
            return;
          }
          
          console.log(`[execute] Built ${candidates.length} candidate plans for user=${user}`);
          
          if (!executionEnabled) {
            // DRY RUN mode: log only
            console.log('[execute] DRY RUN mode - would attempt liquidation with candidates above');
            console.log(`[execute] Set EXECUTION_ENABLED=true to enable real execution`);
            
            // Record attempt for first candidate
            const firstCandidate = candidates[0];
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'sent',
              debtAsset: firstCandidate.debtAsset,
              collateralAsset: firstCandidate.collateralAsset,
              debtToCover: firstCandidate.debtToCover.toString()
            });
            return;
          }
          
          // REAL EXECUTION PATH: Quote-based candidate selection
          try {
            // Quote each candidate and compute netDebtToken
            const quotedCandidates: Array<{
              candidate: typeof candidates[0];
              minOut: bigint;
              netDebtToken: bigint;
              swapData: string;
            }> = [];
            
            for (let i = 0; i < candidates.length; i++) {
              const candidate = candidates[i];
              
              try {
                console.log(
                  `[execute] Requesting quote for candidate ${i + 1}/${candidates.length}: ` +
                  `debt=${candidate.debtAsset.substring(0, 10)}... ` +
                  `collateral=${candidate.collateralAsset.substring(0, 10)}...`
                );
                
                // Request 1inch quote
                const swapQuote = await oneInchBuilder.getSwapCalldata({
                  fromToken: candidate.collateralAsset,
                  toToken: candidate.debtAsset,
                  amount: candidate.expectedCollateralOut.toString(),
                  fromAddress: executorClient.getAddress(),
                  slippageBps: SWAP_SLIPPAGE_BPS
                });
                
                const minOut = BigInt(swapQuote.minOut);
                const netDebtToken = computeNetDebtToken(minOut, candidate.debtToCover);
                
                console.log(
                  `[execute] Candidate ${i + 1}: oracleScore=${(Number(candidate.oracleScore) / 1e18).toFixed(6)} ` +
                  `minOut=${minOut.toString()} netDebtToken=${netDebtToken.toString()}`
                );
                
                // Only consider candidates with positive net outcome
                if (netDebtToken > 0n) {
                  quotedCandidates.push({
                    candidate,
                    minOut,
                    netDebtToken,
                    swapData: swapQuote.data
                  });
                } else {
                  console.warn(
                    `[execute] Candidate ${i + 1} has non-positive netDebtToken (${netDebtToken.toString()}), skipping`
                  );
                }
              } catch (err) {
                console.warn(
                  `[execute] Failed to quote candidate ${i + 1}: ${err instanceof Error ? err.message : err}`
                );
                // Continue to next candidate
              }
            }
            
            // If no viable candidates after quoting, abort
            if (quotedCandidates.length === 0) {
              console.error(`[execute] All candidates failed quoting or have non-positive netDebtToken`);
              attemptHistory.record({
                user,
                timestamp: Date.now(),
                status: 'error',
                error: 'All candidates failed quoting or have non-positive netDebtToken'
              });
              return;
            }
            
            // Choose candidate with maximum netDebtToken
            quotedCandidates.sort((a, b) => {
              if (a.netDebtToken > b.netDebtToken) return -1;
              if (a.netDebtToken < b.netDebtToken) return 1;
              return 0;
            });
            
            const chosen = quotedCandidates[0];
            console.log(
              `[execute] ⭐ Chosen candidate: debt=${chosen.candidate.debtAsset.substring(0, 10)}... ` +
              `collateral=${chosen.candidate.collateralAsset.substring(0, 10)}... ` +
              `netDebtToken=${chosen.netDebtToken.toString()}`
            );
            console.log(
              `[execute] debtToCover=${chosen.candidate.debtToCover.toString()} (${chosen.candidate.debtAssetDecimals} decimals)`
            );
            console.log(
              `[execute] expectedCollateralOut=${chosen.candidate.expectedCollateralOut.toString()} (${chosen.candidate.collateralAssetDecimals} decimals)`
            );
            console.log(
              `[execute] liquidationBonus=${chosen.candidate.liquidationBonusBps} BPS (${chosen.candidate.liquidationBonusBps / 100}%)`
            );
            
            // Get pending nonce before execution
            const pendingNonce = await executorClient.getPendingNonce();
            
            // Execute liquidation with chosen candidate
            const result = await executorClient.attemptLiquidation({
              user,
              collateralAsset: chosen.candidate.collateralAsset,
              debtAsset: chosen.candidate.debtAsset,
              debtToCover: chosen.candidate.debtToCover,
              oneInchCalldata: chosen.swapData,
              minOut: chosen.minOut,
              payout: executorClient.getWalletAddress(),
              expectedCollateralOut: chosen.candidate.expectedCollateralOut
            });
            
            if (result.status === 'mined') {
              console.log(`[execute] ✅ Liquidation successful! txHash=${result.txHash}`);
              attemptHistory.record({
                user,
                timestamp: Date.now(),
                status: 'included',
                txHash: result.txHash,
                nonce: pendingNonce,
                debtAsset: chosen.candidate.debtAsset,
                collateralAsset: chosen.candidate.collateralAsset,
                debtToCover: chosen.candidate.debtToCover.toString()
              });
            } else if (result.status === 'pending') {
              console.warn(`[execute] ⏳ Liquidation pending (not mined yet): txHash=${result.txHash}`);
              metrics.incrementPendingAttempts();
              attemptHistory.record({
                user,
                timestamp: Date.now(),
                status: 'pending',
                txHash: result.txHash,
                nonce: pendingNonce,
                debtAsset: chosen.candidate.debtAsset,
                collateralAsset: chosen.candidate.collateralAsset,
                debtToCover: chosen.candidate.debtToCover.toString()
              });
            } else {
              console.error(`[execute] ❌ Liquidation failed: ${result.error}`);
              attemptHistory.record({
                user,
                timestamp: Date.now(),
                status: result.txHash ? 'reverted' : 'failed',
                txHash: result.txHash,
                nonce: pendingNonce,
                error: result.error,
                debtAsset: chosen.candidate.debtAsset,
                collateralAsset: chosen.candidate.collateralAsset,
                debtToCover: chosen.candidate.debtToCover.toString()
              });
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[execute] ❌ Exception during liquidation: ${errorMsg}`);
            attemptHistory.record({
              user,
              timestamp: Date.now(),
              status: 'error',
              error: errorMsg
            });
          }
        }
      }
    );
    
    verifierLoop.start();
    console.log('[v2] Verifier loop started\n');

    // 9. Setup block heartbeat (if enabled)
    if (config.LOG_BLOCK_HEARTBEAT) {
      console.log('[v2] Phase 9: Setting up block heartbeat');
      const wsProvider = getWsProvider();
      wsProvider.on('block', (blockNumber: number) => {
        const everyN = Math.max(1, config.BLOCK_HEARTBEAT_EVERY_N);
        if (blockNumber % everyN !== 0) return;
        logHeartbeat(blockNumber, riskSet);
      });
      console.log(`[v2] Block heartbeat enabled (every ${config.BLOCK_HEARTBEAT_EVERY_N} block(s))\n`);
    }

    // 10. Send startup notification
    await notifier.notifyStartup();

    console.log('[v2] ============================================');
    console.log('[v2] Backend V2 is running');
    console.log('[v2] Monitoring Base network for liquidations');
    console.log('[v2] Watched users: ' + riskSet.getBelowThreshold().length + ' (minDebt>=$' + config.MIN_DEBT_USD + ')');
    console.log('[v2] Press Ctrl+C to stop');
    console.log('[v2] ============================================\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      verifierLoop.stop();
      aaveListeners.stop();
      liquidationAudit.stop();
      await pythListener.stop();
      await notifier.notify('🛑 <b>LiquidBot v2 Stopped</b>');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[v2] Shutting down gracefully...');
      verifierLoop.stop();
      aaveListeners.stop();
      liquidationAudit.stop();
      await pythListener.stop();
      await notifier.notify('🛑 <b>LiquidBot v2 Stopped</b>');
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
