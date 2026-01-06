// predictive/PredictiveLoop.ts: Pyth-driven predictive liquidation loop
// Subscribes to Pyth price updates and triggers targeted rescoring

import type { PythListener, PythPriceUpdate } from '../prices/PythListener.js';
import type { UserIndex } from './UserIndex.js';
import type { HealthFactorChecker } from '../risk/HealthFactorChecker.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';
import type { LiquidationPlanner } from '../execution/liquidationPlanner.js';
import type { OneInchSwapBuilder } from '../execution/oneInch.js';
import { PlanCache, type PreparedPlan } from '../execution/PlanCache.js';
import { config } from '../config/index.js';

// Default symbol to address mapping for Base (fallback if config not provided)
const DEFAULT_SYMBOL_TO_ADDRESS: Record<string, string> = {
  'ETH': '0x0000000000000000000000000000000000000000',
  'WETH': '0x4200000000000000000000000000000000000006',
  'USDC': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'WBTC': '0x0555e30da8f98308edb960aa94c0db47230d2b9c',
  'cbETH': '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  'DAI': '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  'USDbC': '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
};

// Statistics for heartbeat
export interface PredictiveStats {
  pythTicksSeen: number;
  pythTriggers: number;
  affectedUsersTotal: number;
  rescoredUsers: number;
  plansPrepared: number;
}

/**
 * PredictiveLoop: Monitor Pyth price updates and trigger predictive rescoring
 * 
 * Flow:
 * 1. Subscribe to PythListener updates
 * 2. On each tick, compute % price move vs last cached price
 * 3. If movement exceeds threshold, fetch affected users from UserIndex
 * 4. Rate-limit and rescore those users
 * 5. If projected HF < prepare threshold, prepare and cache execution plan
 * 6. If on-chain HF ≤ 1, execute immediately using cached plan (existing verifier loop handles this)
 */
export class PredictiveLoop {
  private pythListener: PythListener;
  private userIndex: UserIndex;
  private hfChecker: HealthFactorChecker;
  private riskSet: ActiveRiskSet;
  private planCache: PlanCache;
  private planner: LiquidationPlanner | null = null;
  private oneInch: OneInchSwapBuilder | null = null;
  
  // Symbol to address mapping (from config or default)
  private symbolToAddress: Record<string, string>;
  
  // Track last seen price for each token (lowercase address -> price)
  private lastPrices: Map<string, number> = new Map();
  
  // Rate limiting: user address -> last rescore timestamp
  private lastRescoreTime: Map<string, number> = new Map();
  
  // Per-token movement thresholds (lowercase address -> threshold)
  private tokenThresholds: Map<string, number> = new Map();
  
  // Default threshold
  private defaultThreshold: number;
  
  // Rate limit in ms
  private rescoreRateLimitMs: number;
  
  // Prepare HF thresholds
  private prepareHfThreshold: number;
  private urgentHfThreshold: number;
  
  // Track unknown symbols to avoid log spam
  private unknownSymbols: Set<string> = new Set();
  
  // Statistics
  private stats: PredictiveStats = {
    pythTicksSeen: 0,
    pythTriggers: 0,
    affectedUsersTotal: 0,
    rescoredUsers: 0,
    plansPrepared: 0
  };

  constructor(
    pythListener: PythListener,
    userIndex: UserIndex,
    hfChecker: HealthFactorChecker,
    riskSet: ActiveRiskSet
  ) {
    this.pythListener = pythListener;
    this.userIndex = userIndex;
    this.hfChecker = hfChecker;
    this.riskSet = riskSet;
    this.planCache = new PlanCache();
    
    // Load symbol to address mapping from config or use default
    this.symbolToAddress = config.PYTH_SYMBOL_TO_ADDRESS_JSON || DEFAULT_SYMBOL_TO_ADDRESS;
    
    // Load configuration
    this.defaultThreshold = config.PYTH_MIN_PCT_MOVE_DEFAULT || 0.0005;
    this.rescoreRateLimitMs = config.PREDICT_MIN_RESCORE_INTERVAL_MS || 500;
    this.prepareHfThreshold = config.PREDICT_PREPARE_HF || 1.02;
    this.urgentHfThreshold = config.PREDICT_URGENT_HF || 1.005;
    
    // Load per-token thresholds if configured
    if (config.PYTH_MIN_PCT_MOVE_JSON) {
      for (const [tokenAddress, threshold] of Object.entries(config.PYTH_MIN_PCT_MOVE_JSON)) {
        if (typeof threshold === 'number') {
          this.tokenThresholds.set(tokenAddress.toLowerCase(), threshold);
        }
      }
    }
    
    console.log(
      `[predict] PredictiveLoop initialized: ` +
      `defaultThreshold=${this.defaultThreshold} ` +
      `rescoreInterval=${this.rescoreRateLimitMs}ms ` +
      `prepareHF=${this.prepareHfThreshold} ` +
      `urgentHF=${this.urgentHfThreshold}`
    );
  }
  
  /**
   * Set optional planner and oneInch for plan preparation
   */
  setExecutionComponents(planner: LiquidationPlanner, oneInch: OneInchSwapBuilder): void {
    this.planner = planner;
    this.oneInch = oneInch;
  }
  
  /**
   * Get plan cache instance
   */
  getPlanCache(): PlanCache {
    return this.planCache;
  }
  
  /**
   * Get statistics
   */
  getStats(): PredictiveStats & ReturnType<PlanCache['getStats']> {
    return {
      ...this.stats,
      ...this.planCache.getStats()
    };
  }

  /**
   * Start listening to Pyth price updates
   */
  start(): void {
    this.pythListener.onPriceUpdate((update) => {
      this.handlePriceUpdate(update);
    });
    
    console.log('[predict] PredictiveLoop started');
  }

  /**
   * Handle a Pyth price update
   */
  private async handlePriceUpdate(update: PythPriceUpdate): Promise<void> {
    this.stats.pythTicksSeen++;
    
    // Resolve symbol to token address using config mapping
    const tokenAddress = this.symbolToAddress[update.symbol.toUpperCase()];
    
    if (!tokenAddress) {
      // Unknown symbol - log once per symbol to avoid spam
      if (!this.unknownSymbols.has(update.symbol)) {
        console.warn(`[predict] Unknown symbol ${update.symbol} - no address mapping configured`);
        this.unknownSymbols.add(update.symbol);
      }
      return;
    }
    
    // Use lowercase address as canonical key
    const tokenKey = tokenAddress.toLowerCase();
    
    // Get last price
    const lastPrice = this.lastPrices.get(tokenKey);
    
    // Update last price
    this.lastPrices.set(tokenKey, update.price);
    
    // If this is the first price for this token, skip movement calculation
    if (lastPrice === undefined) {
      console.log(
        `[predict] Initial price for ${update.symbol} (${tokenKey.substring(0, 10)}...): $${update.price.toFixed(2)}`
      );
      return;
    }
    
    // Compute % movement
    const pctMove = Math.abs((update.price - lastPrice) / lastPrice);
    
    // Get threshold for this token
    const threshold = this.tokenThresholds.get(tokenKey) || this.defaultThreshold;
    
    // Check if movement exceeds threshold
    if (pctMove < threshold) {
      // Below threshold - do nothing
      return;
    }
    
    this.stats.pythTriggers++;
    
    // Log tick with token address
    console.log(
      `[predict] tick token=${update.symbol} addr=${tokenKey.substring(0, 10)}... ` +
      `price=$${update.price.toFixed(2)} ` +
      `lastPrice=$${lastPrice.toFixed(2)} ` +
      `pctMove=${(pctMove * 100).toFixed(3)}% ` +
      `threshold=${(threshold * 100).toFixed(3)}%`
    );
    
    // Get affected users from UserIndex using token address
    const affectedUsers = this.userIndex.getUsersForToken(tokenKey);
    
    if (affectedUsers.size === 0) {
      console.log(`[predict] No users indexed for token ${update.symbol} (${tokenKey.substring(0, 10)}...)`);
      return;
    }
    
    this.stats.affectedUsersTotal += affectedUsers.size;
    console.log(`[predict] tick affectedUsers=${affectedUsers.size}`);
    
    // Rate-limit and rescore affected users
    // TODO: Performance optimization - Consider batch rescoring using hfChecker.checkBatch()
    // when many users are affected. Current implementation uses sequential rescoring with
    // rate limiting which is acceptable for MVP but could be optimized for high-frequency
    // price updates affecting many users.
    const now = Date.now();
    let rescoredCount = 0;
    
    for (const userAddress of affectedUsers) {
      // Check rate limit
      const lastRescore = this.lastRescoreTime.get(userAddress);
      if (lastRescore && (now - lastRescore) < this.rescoreRateLimitMs) {
        // Skip - too soon since last rescore
        continue;
      }
      
      // Update rate limit timestamp
      this.lastRescoreTime.set(userAddress, now);
      
      // Rescore this user
      try {
        await this.rescoreUser(userAddress);
        rescoredCount++;
      } catch (err) {
        console.error(
          `[predict] Error rescoring user ${userAddress}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    
    this.stats.rescoredUsers += rescoredCount;
    console.log(`[predict] Rescored ${rescoredCount}/${affectedUsers.size} users for ${update.symbol}`);
  }

  /**
   * Rescore a single user's health factor and prepare plan if needed
   */
  private async rescoreUser(userAddress: string): Promise<void> {
    // Check current HF from on-chain
    const result = await this.hfChecker.checkSingle(userAddress);
    
    if (!result) {
      console.warn(`[predict] No HF result for user ${userAddress}`);
      return;
    }
    
    // Update risk set with fresh HF
    this.riskSet.updateHF(userAddress, result.healthFactor, result.debtUsd1e18);
    
    const debtUsdDisplay = Number(result.debtUsd1e18) / 1e18;
    
    // Check if we should prepare a plan
    if (result.healthFactor < this.prepareHfThreshold && result.healthFactor > 0) {
      console.log(
        `[prepare] user=${userAddress.substring(0, 10)}... projectedHF=${result.healthFactor.toFixed(4)} debtUsd=$${debtUsdDisplay.toFixed(2)}`
      );
      
      // Try to prepare a plan
      if (this.planner && this.oneInch) {
        try {
          await this.preparePlan(userAddress);
        } catch (err) {
          console.warn(
            `[prepare] Failed to prepare plan for ${userAddress.substring(0, 10)}...:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }
  
  /**
   * Prepare and cache a liquidation plan for a user
   */
  private async preparePlan(userAddress: string): Promise<void> {
    if (!this.planner || !this.oneInch) return;
    
    try {
      // Build candidate plans
      const candidates = await this.planner.buildCandidatePlans(userAddress);
      
      if (!candidates || candidates.length === 0) {
        return;
      }
      
      // Use first candidate (highest oracle score)
      const candidate = candidates[0];
      
      // Get 1inch quote
      const swapQuote = await this.oneInch.getSwapCalldata({
        fromToken: candidate.collateralAsset,
        toToken: candidate.debtAsset,
        amount: candidate.expectedCollateralOut.toString(),
        fromAddress: candidate.collateralAsset, // Placeholder - executor will be set at execution time
        slippageBps: 100 // 1% slippage
      });
      
      const minOut = BigInt(swapQuote.minOut);
      
      // Store prepared plan
      const plan: PreparedPlan = {
        user: userAddress,
        debtAsset: candidate.debtAsset,
        collateralAsset: candidate.collateralAsset,
        debtToCover: candidate.debtToCover,
        expectedCollateralOut: candidate.expectedCollateralOut,
        minOut,
        oneInchCalldata: swapQuote.data,
        score: candidate.oracleScore,
        createdAt: Date.now()
      };
      
      this.planCache.prepare(plan);
      this.stats.plansPrepared++;
      
      console.log(
        `[prepare] Plan cached for user=${userAddress.substring(0, 10)}... ` +
        `debt=${candidate.debtAsset.substring(0, 10)}... ` +
        `collateral=${candidate.collateralAsset.substring(0, 10)}...`
      );
    } catch (err) {
      // Plan preparation is best-effort - don't fail rescoring
      console.warn(
        `[prepare] Plan preparation failed for ${userAddress.substring(0, 10)}...:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
