// predictive/loop.ts: Predictive loop orchestrator
// Listens to Pyth price updates and triggers re-scoring for affected users

import type { PythListener, PythPriceUpdate } from '../prices/PythListener.js';
import type { UserIndex } from './userIndex.js';
import type { Rescorer } from './rescorer.js';
import type { PlanCache } from './planCache.js';
import { config } from '../config/index.js';

/**
 * PredictiveLoop: Orchestrate Pyth-driven predictive re-scoring
 */
export class PredictiveLoop {
  private pythListener: PythListener;
  private userIndex: UserIndex;
  private rescorer: Rescorer;
  private planCache: PlanCache;
  
  // Track last price per symbol for move detection
  private lastPrices = new Map<string, bigint>();
  
  // Track last rescore timestamp per user for rate limiting
  private lastRescoreTs = new Map<string, number>();
  
  private isRunning = false;
  private minPctMoveDefault: number;
  private minPctMoveBySymbol: Map<string, number>;
  
  // Execution callback: called when user needs execution (HF ≤ 1.0)
  private onExecute?: (user: string, healthFactor: number, debtUsd1e18: bigint) => Promise<void>;

  constructor(
    pythListener: PythListener,
    userIndex: UserIndex,
    rescorer: Rescorer,
    planCache: PlanCache,
    onExecute?: (user: string, healthFactor: number, debtUsd1e18: bigint) => Promise<void>
  ) {
    this.pythListener = pythListener;
    this.userIndex = userIndex;
    this.rescorer = rescorer;
    this.planCache = planCache;
    this.onExecute = onExecute;
    
    // Load move thresholds from config
    this.minPctMoveDefault = config.PYTH_MIN_PCT_MOVE_DEFAULT;
    this.minPctMoveBySymbol = new Map();
    if (config.PYTH_MIN_PCT_MOVE_JSON) {
      for (const [symbol, pct] of Object.entries(config.PYTH_MIN_PCT_MOVE_JSON)) {
        this.minPctMoveBySymbol.set(symbol.toUpperCase(), pct as number);
      }
    }
  }

  /**
   * Start the predictive loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[predictive-loop] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[predictive-loop] Starting Pyth-driven predictive loop');

    // Subscribe to Pyth price updates
    this.pythListener.onPriceUpdate((update: PythPriceUpdate) => {
      this.handlePriceUpdate(update);
    });
  }

  /**
   * Stop the predictive loop
   */
  stop(): void {
    this.isRunning = false;
    console.log('[predictive-loop] Stopped');
  }

  /**
   * Handle a Pyth price update
   */
  private async handlePriceUpdate(update: PythPriceUpdate): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const symbol = update.symbol.toUpperCase();
    const price1e18 = BigInt(Math.floor(update.price * 1e18));
    
    // Check if price moved significantly
    const lastPrice = this.lastPrices.get(symbol);
    if (lastPrice) {
      const minPctMove = this.minPctMoveBySymbol.get(symbol) || this.minPctMoveDefault;
      const pctMove = Math.abs(Number(price1e18 - lastPrice)) / Number(lastPrice);
      
      if (pctMove < minPctMove) {
        // Price move too small - skip
        return;
      }
      
      console.log(
        `[predictive-loop] ${symbol} moved ${(pctMove * 100).toFixed(2)}% ` +
        `(threshold: ${(minPctMove * 100).toFixed(2)}%)`
      );
    }
    
    // Update last price
    this.lastPrices.set(symbol, price1e18);
    
    // Get all users holding this token
    const affectedUsers = this.userIndex.getUsersByToken(symbol);
    
    if (affectedUsers.size === 0) {
      return;
    }
    
    console.log(`[predictive-loop] ${symbol} update affects ${affectedUsers.size} users`);
    
    // Filter users by rate limit
    const now = Date.now();
    const minInterval = config.PREDICT_MIN_RESCORE_INTERVAL_MS;
    const usersToRescore: string[] = [];
    
    for (const user of affectedUsers) {
      const lastRescore = this.lastRescoreTs.get(user) || 0;
      if (now - lastRescore >= minInterval) {
        usersToRescore.push(user);
        this.lastRescoreTs.set(user, now);
      }
    }
    
    if (usersToRescore.length === 0) {
      return;
    }
    
    console.log(
      `[predictive-loop] Re-scoring ${usersToRescore.length} users ` +
      `(${affectedUsers.size - usersToRescore.length} rate-limited)`
    );
    
    // Re-score users in batch
    const rescored = await this.rescorer.rescoreBatch(usersToRescore);
    console.log(`[predictive-loop] Re-scored ${rescored} users`);
    
    // Check if any users need execution (HF ≤ 1.0)
    if (this.onExecute) {
      // This would be implemented by checking the riskSet for users below threshold
      // and calling onExecute for each one
      // For now, we skip this as it requires integration with the main execution loop
    }
  }

  /**
   * Get loop statistics
   */
  getStats(): { trackedSymbols: number; trackedUsers: number } {
    return {
      trackedSymbols: this.lastPrices.size,
      trackedUsers: this.lastRescoreTs.size
    };
  }
}
