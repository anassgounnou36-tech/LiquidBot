// predictive/planCache.ts: Pre-submit plan caching for instant execution
// Prepares liquidation plans ahead of time so they can be executed instantly when HF≤1

import type { LiquidationPlanner } from '../execution/liquidationPlanner.js';

export interface CachedPlan {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  expectedCollateralOut: bigint;
  collateralAssetDecimals: number;
  debtAssetDecimals: number;
  liquidationBonusBps: number;
  oracleScore: bigint;
  timestamp: number;
}

/**
 * PlanCache: Cache liquidation plans ahead of time for instant execution
 */
export class PlanCache {
  // Map: userAddress -> CachedPlan[]
  private cache = new Map<string, CachedPlan[]>();
  
  private planner: LiquidationPlanner;
  
  // Cache TTL: plans older than this are considered stale
  private readonly PLAN_TTL_MS = 10000; // 10 seconds

  constructor(planner: LiquidationPlanner) {
    this.planner = planner;
  }

  /**
   * Pre-build plans for a user
   * @param user User address
   * @returns Promise<number> Number of plans cached
   */
  async prebuildPlans(user: string): Promise<number> {
    const normalizedUser = user.toLowerCase();
    
    try {
      const candidates = await this.planner.buildCandidatePlans(user);
      
      if (!candidates || candidates.length === 0) {
        return 0;
      }
      
      // Convert to cached format
      const cachedPlans: CachedPlan[] = candidates.map(c => ({
        user: normalizedUser,
        collateralAsset: c.collateralAsset,
        debtAsset: c.debtAsset,
        debtToCover: c.debtToCover,
        expectedCollateralOut: c.expectedCollateralOut,
        collateralAssetDecimals: c.collateralAssetDecimals,
        debtAssetDecimals: c.debtAssetDecimals,
        liquidationBonusBps: c.liquidationBonusBps,
        oracleScore: c.oracleScore,
        timestamp: Date.now()
      }));
      
      this.cache.set(normalizedUser, cachedPlans);
      return cachedPlans.length;
    } catch (err) {
      console.error(
        `[planCache] Failed to pre-build plans for ${user}:`,
        err instanceof Error ? err.message : err
      );
      return 0;
    }
  }

  /**
   * Get cached plans for a user (only if fresh)
   * @param user User address
   * @returns CachedPlan[] | null
   */
  getPlans(user: string): CachedPlan[] | null {
    const normalizedUser = user.toLowerCase();
    const cached = this.cache.get(normalizedUser);
    
    if (!cached) {
      return null;
    }
    
    // Check if plans are still fresh
    const now = Date.now();
    const age = now - cached[0].timestamp;
    
    if (age > this.PLAN_TTL_MS) {
      // Stale - remove from cache
      this.cache.delete(normalizedUser);
      return null;
    }
    
    return cached;
  }

  /**
   * Invalidate cached plans for a user
   * @param user User address
   */
  invalidate(user: string): void {
    const normalizedUser = user.toLowerCase();
    this.cache.delete(normalizedUser);
  }

  /**
   * Get cache statistics
   */
  getStats(): { cachedUsers: number; totalPlans: number } {
    let totalPlans = 0;
    for (const plans of this.cache.values()) {
      totalPlans += plans.length;
    }
    
    return {
      cachedUsers: this.cache.size,
      totalPlans
    };
  }

  /**
   * Clear stale plans from cache
   */
  clearStale(): number {
    const now = Date.now();
    let cleared = 0;
    
    for (const [user, plans] of this.cache.entries()) {
      const age = now - plans[0].timestamp;
      if (age > this.PLAN_TTL_MS) {
        this.cache.delete(user);
        cleared++;
      }
    }
    
    return cleared;
  }
}
