// execution/PlanCache.ts: Cache prepared liquidation plans for instant execution

import { config } from '../config/index.js';

export interface PreparedPlan {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: bigint;
  expectedCollateralOut: bigint;
  minOut: bigint;
  oneInchCalldata: string;
  score: bigint; // profit estimate (oracle-based)
  createdAt: number;
  // Real metadata (not placeholders)
  debtAssetDecimals: number;
  collateralAssetDecimals: number;
  liquidationBonusBps: number;
}

/**
 * PlanCache: Store and retrieve prepared liquidation plans
 * Enables instant execution when HF drops below threshold
 */
export class PlanCache {
  private cache: Map<string, PreparedPlan> = new Map();
  private ttlMs: number;
  private maxUsers: number;
  
  // Statistics
  private stats = {
    plansCached: 0,
    expired: 0,
    evicted: 0,
    hits: 0,
    misses: 0
  };

  constructor() {
    this.ttlMs = config.PLAN_TTL_MS || 15000;
    this.maxUsers = config.PLAN_MAX_USERS || 2000;
    
    console.log(`[plan-cache] Initialized: ttl=${this.ttlMs}ms maxUsers=${this.maxUsers}`);
  }

  /**
   * Store a prepared plan
   */
  prepare(plan: PreparedPlan): void {
    const userKey = plan.user.toLowerCase();
    
    // Evict if at capacity
    if (this.cache.size >= this.maxUsers && !this.cache.has(userKey)) {
      this.evictOldest();
    }
    
    this.cache.set(userKey, plan);
    this.stats.plansCached++;
  }

  /**
   * Get a prepared plan (respects TTL)
   */
  get(user: string): PreparedPlan | null {
    const userKey = user.toLowerCase();
    const plan = this.cache.get(userKey);
    
    if (!plan) {
      this.stats.misses++;
      return null;
    }
    
    // Check TTL
    const age = Date.now() - plan.createdAt;
    if (age > this.ttlMs) {
      this.cache.delete(userKey);
      this.stats.expired++;
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    return plan;
  }

  /**
   * Invalidate a plan
   */
  invalidate(user: string): void {
    const userKey = user.toLowerCase();
    this.cache.delete(userKey);
  }

  /**
   * Evict oldest plan (by createdAt)
   */
  private evictOldest(): void {
    let oldestUser: string | null = null;
    let oldestTime = Infinity;
    
    for (const [user, plan] of this.cache.entries()) {
      if (plan.createdAt < oldestTime) {
        oldestTime = plan.createdAt;
        oldestUser = user;
      }
    }
    
    if (oldestUser) {
      this.cache.delete(oldestUser);
      this.stats.evicted++;
    }
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats & { plansCacheSize: number } {
    return {
      ...this.stats,
      plansCacheSize: this.cache.size
    };
  }

  /**
   * Clear all plans
   */
  clear(): void {
    this.cache.clear();
  }
}
