/**
 * GlobalRpcRateLimiter: Token bucket rate limiter for RPC calls
 * 
 * Purpose: Prevent RPC drain by enforcing a global rate limit across all scan types
 * Uses token bucket algorithm with configurable:
 * - Rate limit (calls/sec)
 * - Burst capacity (max tokens)
 * - Refill rate
 * 
 * Features:
 * - Non-blocking acquire with timeout
 * - Backpressure tracking and metrics
 * - Graceful degradation under load
 */

import { config } from '../config/index.js';
import { rpcRateLimitWaitsTotal, rpcRateLimitDropsTotal, rpcRateLimitTokensAvailable } from '../metrics/index.js';

export interface RateLimiterOptions {
  rateLimit?: number; // calls per second
  burstCapacity?: number; // max tokens
  refillIntervalMs?: number; // how often to refill tokens
}

export interface AcquireOptions {
  cost?: number; // number of tokens to acquire (default 1)
  timeoutMs?: number; // max time to wait (default: no timeout)
}

/**
 * GlobalRpcRateLimiter enforces a global rate limit on RPC calls
 * Also enforces max in-flight eth_call limit via semaphore
 */
export class GlobalRpcRateLimiter {
  private tokens: number;
  private readonly rateLimit: number; // calls/sec
  private readonly burstCapacity: number;
  private readonly refillIntervalMs: number;
  private readonly tokensPerRefill: number;
  
  // Semaphore for max in-flight eth_call limit
  private inFlightCalls = 0;
  private readonly maxInFlight: number;
  private inFlightWaitQueue: Array<() => void> = [];
  
  private lastRefillTime: number;
  private totalWaits = 0;
  private totalDrops = 0;
  private totalInFlightWaits = 0;
  
  private refillTimer?: NodeJS.Timeout;
  
  constructor(options?: RateLimiterOptions) {
    this.rateLimit = options?.rateLimit ?? config.globalRpcRateLimit ?? 50; // 50 calls/sec default
    this.burstCapacity = options?.burstCapacity ?? config.globalRpcBurstCapacity ?? 100;
    this.refillIntervalMs = options?.refillIntervalMs ?? 100; // 100ms refill interval
    this.maxInFlight = config.ethCallMaxInFlight ?? 120; // 120 concurrent calls default
    
    // Calculate tokens per refill: (rateLimit * refillInterval) / 1000
    this.tokensPerRefill = (this.rateLimit * this.refillIntervalMs) / 1000;
    
    // Start with full capacity
    this.tokens = this.burstCapacity;
    this.lastRefillTime = Date.now();
    
    console.log(
      `[rpc-rate-limiter] Initialized: rate=${this.rateLimit}/s, ` +
      `burst=${this.burstCapacity}, refillInterval=${this.refillIntervalMs}ms, ` +
      `tokensPerRefill=${this.tokensPerRefill.toFixed(2)}, maxInFlight=${this.maxInFlight}`
    );
    
    // Start refill timer
    this.startRefill();
  }
  
  /**
   * Attempt to acquire tokens for an RPC call
   * 
   * Returns true if tokens acquired, false if not enough tokens available
   */
  public async acquire(options?: AcquireOptions): Promise<boolean> {
    const cost = options?.cost ?? 1;
    const timeoutMs = options?.timeoutMs;
    
    const startTime = Date.now();
    
    // Try immediate acquisition
    if (this.tryAcquire(cost)) {
      return true;
    }
    
    // No timeout - drop request
    if (!timeoutMs) {
      this.totalDrops++;
      rpcRateLimitDropsTotal.inc({ reason: 'no_tokens' });
      
      console.log(
        `[rpc-rate-limit] Request dropped: cost=${cost} tokens=${this.tokens.toFixed(2)}/${this.burstCapacity}`
      );
      
      return false;
    }
    
    // Wait with timeout
    this.totalWaits++;
    rpcRateLimitWaitsTotal.inc();
    
    // Poll for tokens with exponential backoff
    const maxWaitMs = timeoutMs;
    let waitMs = 10; // Start with 10ms
    
    while (Date.now() - startTime < maxWaitMs) {
      await this.sleep(waitMs);
      
      if (this.tryAcquire(cost)) {
        const actualWaitMs = Date.now() - startTime;
        console.log(
          `[rpc-rate-limit] Acquired after wait: cost=${cost} wait=${actualWaitMs}ms`
        );
        return true;
      }
      
      // Exponential backoff (10ms -> 20ms -> 40ms -> 80ms -> MAX_BACKOFF_MS cap)
      const MAX_BACKOFF_MS = 100;
      waitMs = Math.min(waitMs * 2, MAX_BACKOFF_MS);
    }
    
    // Timeout exceeded - drop request
    this.totalDrops++;
    rpcRateLimitDropsTotal.inc({ reason: 'timeout' });
    
    console.log(
      `[rpc-rate-limit] Request timed out: cost=${cost} timeout=${timeoutMs}ms`
    );
    
    return false;
  }
  
  /**
   * Try to acquire tokens immediately (non-blocking)
   */
  private tryAcquire(cost: number): boolean {
    if (this.tokens >= cost) {
      this.tokens -= cost;
      rpcRateLimitTokensAvailable.set(this.tokens);
      return true;
    }
    return false;
  }
  
  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Start token refill timer
   */
  private startRefill(): void {
    this.refillTimer = setInterval(() => {
      this.refill();
    }, this.refillIntervalMs);
  }
  
  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    
    // Calculate tokens to add based on elapsed time
    const tokensToAdd = (this.rateLimit * elapsed) / 1000;
    
    // Add tokens up to burst capacity
    this.tokens = Math.min(this.tokens + tokensToAdd, this.burstCapacity);
    this.lastRefillTime = now;
    
    // Update metric
    rpcRateLimitTokensAvailable.set(this.tokens);
  }
  
  /**
   * Get current token count
   */
  public getTokens(): number {
    return this.tokens;
  }
  
  /**
   * Get rate limiter stats
   */
  public getStats() {
    return {
      tokens: this.tokens,
      burstCapacity: this.burstCapacity,
      rateLimit: this.rateLimit,
      totalWaits: this.totalWaits,
      totalDrops: this.totalDrops,
      inFlightCalls: this.inFlightCalls,
      maxInFlight: this.maxInFlight,
      totalInFlightWaits: this.totalInFlightWaits
    };
  }
  
  /**
   * Acquire an in-flight call slot (semaphore)
   * Returns true if acquired, false if would exceed max in-flight
   */
  public async acquireInFlight(timeoutMs = 5000): Promise<boolean> {
    if (this.inFlightCalls < this.maxInFlight) {
      this.inFlightCalls++;
      return true;
    }
    
    // Wait for a slot to become available
    this.totalInFlightWaits++;
    const startTime = Date.now();
    
    return new Promise<boolean>((resolve) => {
      const checkTimeout = () => {
        if (Date.now() - startTime >= timeoutMs) {
          // Remove from queue and timeout
          const idx = this.inFlightWaitQueue.indexOf(resolver);
          if (idx >= 0) {
            this.inFlightWaitQueue.splice(idx, 1);
          }
          resolve(false);
        }
      };
      
      const resolver = () => {
        this.inFlightCalls++;
        resolve(true);
      };
      
      this.inFlightWaitQueue.push(resolver);
      
      // Set timeout
      setTimeout(checkTimeout, timeoutMs);
    });
  }
  
  /**
   * Release an in-flight call slot
   */
  public releaseInFlight(): void {
    if (this.inFlightCalls > 0) {
      this.inFlightCalls--;
      
      // Wake up waiting callers
      const next = this.inFlightWaitQueue.shift();
      if (next) {
        next();
      }
    }
  }
  
  /**
   * Stop refill timer
   */
  public stop(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
    }
    
    console.log(
      `[rpc-rate-limiter] Stopped: waits=${this.totalWaits} drops=${this.totalDrops} ` +
      `inFlightWaits=${this.totalInFlightWaits}`
    );
  }
  
  /**
   * Reset tokens to full capacity (for testing)
   */
  public reset(): void {
    this.tokens = this.burstCapacity;
    this.lastRefillTime = Date.now();
    this.totalWaits = 0;
    this.totalDrops = 0;
  }
}
