// predictive/PredictiveLoop.ts: Pyth-driven predictive liquidation loop
// Subscribes to Pyth price updates and triggers targeted rescoring

import type { PythListener, PythPriceUpdate } from '../prices/PythListener.js';
import type { UserIndex } from './UserIndex.js';
import type { HealthFactorChecker } from '../risk/HealthFactorChecker.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';
import { config } from '../config/index.js';

/**
 * Symbol to canonical token address mapping for Base network
 * Used to resolve Pyth symbol updates to actual token addresses
 */
const SYMBOL_TO_ADDRESS_MAP: Record<string, string> = {
  'ETH': '0x0000000000000000000000000000000000000000',
  'WETH': '0x4200000000000000000000000000000000000006',
  'USDC': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'WBTC': '0x0555e30da8f98308edb960aa94c0db47230d2b9c',
  'cbETH': '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  'DAI': '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  'USDbC': '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
};

/**
 * PredictiveLoop: Monitor Pyth price updates and trigger predictive rescoring
 * 
 * Flow:
 * 1. Subscribe to PythListener updates
 * 2. On each tick, compute % price move vs last cached price
 * 3. If movement exceeds threshold, fetch affected users from UserIndex
 * 4. Rate-limit and rescore those users
 * 5. If projected HF < prepare threshold, prepare execution plan (TODO: Part 2)
 * 6. If on-chain HF ≤ 1, execute immediately (existing verifier loop handles this)
 */
export class PredictiveLoop {
  private pythListener: PythListener;
  private userIndex: UserIndex;
  private hfChecker: HealthFactorChecker;
  private riskSet: ActiveRiskSet;
  
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
  
  // Prepare HF threshold (for future pre-submit plan caching)
  private prepareHfThreshold: number;
  
  // Track unknown symbols to avoid log spam
  private unknownSymbols: Set<string> = new Set();

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
    
    // Load configuration
    this.defaultThreshold = config.PYTH_MIN_PCT_MOVE_DEFAULT || 0.0005;
    this.rescoreRateLimitMs = config.PREDICTIVE_RESCORE_RATE_LIMIT_MS || 5000;
    this.prepareHfThreshold = config.PREDICTIVE_PREPARE_HF_THRESHOLD || 1.02;
    
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
      `rescoreRateLimit=${this.rescoreRateLimitMs}ms ` +
      `prepareHfThreshold=${this.prepareHfThreshold}`
    );
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
    // Resolve symbol to token address using canonical mapping
    const tokenAddress = SYMBOL_TO_ADDRESS_MAP[update.symbol.toUpperCase()];
    
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
    
    // Log tick
    console.log(
      `[predict] tick token=${update.symbol} (${tokenKey.substring(0, 10)}...) ` +
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
    
    console.log(`[predict] Found ${affectedUsers.size} affected users for ${update.symbol}`);
    
    // Rate-limit and rescore affected users
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
    
    console.log(`[predict] Rescored ${rescoredCount}/${affectedUsers.size} users for ${update.symbol}`);
  }

  /**
   * Rescore a single user's health factor
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
    
    // Log if user is approaching liquidation
    if (result.healthFactor < this.prepareHfThreshold) {
      const debtUsdDisplay = Number(result.debtUsd1e18) / 1e18;
      console.log(
        `[predict] ⚠️  User approaching liquidation: ` +
        `address=${userAddress} ` +
        `HF=${result.healthFactor.toFixed(4)} ` +
        `debtUsd=$${debtUsdDisplay.toFixed(2)}`
      );
      
      // TODO: Part 2 - Prepare and cache execution plan here
      // if (result.healthFactor < this.prepareHfThreshold) {
      //   await this.prepareExecutionPlan(userAddress);
      // }
    }
  }
}
