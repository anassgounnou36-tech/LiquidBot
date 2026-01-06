// predictive/predictiveLoop.ts: Token-aware predictive re-scoring loop with per-token pct-move gates

import { config } from '../config/index.js';
import { UserIndex } from './userIndex.js';
import { getUsdPriceForPrediction } from '../prices/priceMath.js';
import type { DirtyQueue } from '../realtime/dirtyQueue.js';

/**
 * Price snapshot for token movement detection
 */
interface PriceSnapshot {
  price: bigint;
  timestamp: number;
}

/**
 * PredictiveLoop: Token-aware predictive re-scoring loop
 * Monitors price movements per token and triggers re-checks for affected users
 * Uses per-token percentage movement gates to reduce noise
 */
export class PredictiveLoop {
  private userIndex: UserIndex;
  private dirtyQueue: DirtyQueue;
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  
  // Price snapshots: token address (lowercase) -> PriceSnapshot
  private priceSnapshots = new Map<string, PriceSnapshot>();
  
  // Per-token percentage move thresholds (default from config)
  private moveThresholds = new Map<string, number>();
  private defaultMoveThreshold: number;
  
  // Rescore interval from config
  private rescoreIntervalMs: number;

  constructor(userIndex: UserIndex, dirtyQueue: DirtyQueue) {
    this.userIndex = userIndex;
    this.dirtyQueue = dirtyQueue;
    
    // Load default threshold from config
    this.defaultMoveThreshold = config.PYTH_MIN_PCT_MOVE_DEFAULT;
    
    // Load per-token thresholds from config (if provided)
    if (config.PYTH_MIN_PCT_MOVE_JSON) {
      for (const [symbol, threshold] of Object.entries(config.PYTH_MIN_PCT_MOVE_JSON)) {
        if (typeof threshold === 'number') {
          this.moveThresholds.set(symbol.toUpperCase(), threshold);
        }
      }
    }
    
    this.rescoreIntervalMs = config.PREDICT_MIN_RESCORE_INTERVAL_MS;
    
    console.log(
      `[predictiveLoop] Initialized with defaultMoveThreshold=${this.defaultMoveThreshold} ` +
      `rescoreInterval=${this.rescoreIntervalMs}ms customThresholds=${this.moveThresholds.size}`
    );
  }

  /**
   * Start the predictive re-scoring loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[predictiveLoop] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[predictiveLoop] Starting...');

    // Run loop at configured interval
    this.intervalHandle = setInterval(() => {
      this.checkPriceMovements().catch(err => {
        console.error('[predictiveLoop] Error in loop:', err instanceof Error ? err.message : err);
      });
    }, this.rescoreIntervalMs);
  }

  /**
   * Stop the predictive re-scoring loop
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log('[predictiveLoop] Stopped');
  }

  /**
   * Check price movements for all tracked tokens
   */
  private async checkPriceMovements(): Promise<void> {
    const trackedTokens = this.userIndex.getTrackedTokens();
    
    if (trackedTokens.length === 0) {
      // No tokens to track yet
      return;
    }

    for (const tokenAddress of trackedTokens) {
      try {
        await this.checkTokenPriceMovement(tokenAddress);
      } catch (err) {
        // Log error but continue checking other tokens
        console.error(
          `[predictiveLoop] Error checking price for token ${tokenAddress}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  /**
   * Check price movement for a single token and trigger re-checks if threshold exceeded
   * 
   * NOTE: This implementation requires token address → symbol resolution integration.
   * To complete this feature:
   * 1. Import and use addressToSymbolMap from priceMath
   * 2. Call getUsdPriceForPrediction(symbol) after resolving token address to symbol
   * 3. Populate UserIndex with user-token relationships from ProtocolDataProvider
   * 4. Start this loop in index.ts after Phase 5 (realtime triggers are set up)
   */
  private async checkTokenPriceMovement(tokenAddress: string): Promise<void> {
    // Get current price (using prediction path: Chainlink → Pyth → cache → RPC)
    let currentPrice: bigint;
    try {
      // TODO: Implement token address → symbol resolution
      // const symbol = addressToSymbolMap.get(tokenAddress.toLowerCase());
      // if (!symbol) return;
      // currentPrice = await getUsdPriceForPrediction(symbol);
      
      // For now, skip - requires integration with protocol data provider
      return;
    } catch (err) {
      // Price fetch failed - skip this token for now
      return;
    }

    const now = Date.now();
    const snapshot = this.priceSnapshots.get(tokenAddress);

    // Initialize snapshot if first time seeing this token
    if (!snapshot) {
      this.priceSnapshots.set(tokenAddress, { price: currentPrice, timestamp: now });
      return;
    }

    // Store in const to help TypeScript narrow the type
    // Non-null assertion is safe here because we've already checked above
    const lastPrice = snapshot!.price;
    
    // Avoid division by zero
    if (lastPrice === 0n) {
      return;
    }

    // Calculate percentage move
    const priceDiff = currentPrice > lastPrice
      ? currentPrice - lastPrice
      : lastPrice - currentPrice;
    
    // Calculate percentage move: (diff / lastPrice) * 100
    // Using BigInt arithmetic with 1e18 scaling to preserve precision
    const pctMove = Number((priceDiff * 10000n) / lastPrice) / 100;

    // Get threshold for this token (use symbol-based lookup in future)
    const threshold = this.defaultMoveThreshold;

    // Check if movement exceeds threshold
    if (pctMove >= threshold) {
      // Significant price movement detected - mark affected users dirty
      const affectedUsers = this.userIndex.getUsersForToken(tokenAddress);
      
      if (affectedUsers.size > 0) {
        console.log(
          `[predictiveLoop] Price move detected: token=${tokenAddress.substring(0, 10)}... ` +
          `pctMove=${pctMove.toFixed(4)}% threshold=${threshold} affectedUsers=${affectedUsers.size}`
        );
        
        for (const user of affectedUsers) {
          this.dirtyQueue.markDirty(user);
        }
      }

      // Update snapshot after triggering re-checks
      this.priceSnapshots.set(tokenAddress, { price: currentPrice, timestamp: now });
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    isRunning: boolean;
    trackedTokens: number;
    trackedUsers: number;
    snapshotCount: number;
  } {
    const indexStats = this.userIndex.getStats();
    return {
      isRunning: this.isRunning,
      trackedTokens: indexStats.tokenCount,
      trackedUsers: indexStats.userCount,
      snapshotCount: this.priceSnapshots.size
    };
  }
}
