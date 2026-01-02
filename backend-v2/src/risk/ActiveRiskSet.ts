// risk/ActiveRiskSet.ts: Maintain at-risk users from on-chain HF checks

import { config } from '../config/index.js';

export interface CandidateUser {
  address: string;
  healthFactor: number;
  lastDebtUsd1e18: bigint;
  lastChecked: number;
}

/**
 * ActiveRiskSet: Maintain a set of users who are at risk of liquidation
 * Built from on-chain HF checks, NOT subgraph triggers
 */
export class ActiveRiskSet {
  private candidates: Map<string, CandidateUser> = new Map();

  /**
   * Add or update a user in the risk set
   */
  add(address: string, healthFactor: number, debtUsd1e18: bigint = 0n): void {
    const normalized = address.toLowerCase();
    
    this.candidates.set(normalized, {
      address: normalized,
      healthFactor,
      lastDebtUsd1e18: debtUsd1e18,
      lastChecked: Date.now()
    });
  }

  /**
   * Add multiple users in bulk
   */
  addBulk(addresses: string[]): void {
    for (const address of addresses) {
      // Initialize with HF = Infinity, debtUsd = 0 (unchecked)
      this.add(address, Infinity, 0n);
    }
  }

  /**
   * Update health factor and debt USD for a user
   */
  updateHF(address: string, healthFactor: number, debtUsd1e18: bigint): void {
    const normalized = address.toLowerCase();
    const candidate = this.candidates.get(normalized);
    
    if (candidate) {
      candidate.healthFactor = healthFactor;
      candidate.lastDebtUsd1e18 = debtUsd1e18;
      candidate.lastChecked = Date.now();
    } else {
      this.add(normalized, healthFactor, debtUsd1e18);
    }
  }

  /**
   * Get a user from the risk set
   */
  get(address: string): CandidateUser | undefined {
    return this.candidates.get(address.toLowerCase());
  }

  /**
   * Get all users below HF threshold AND above minimum debt
   */
  getBelowThreshold(): CandidateUser[] {
    const threshold = config.HF_THRESHOLD_START;
    const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
    
    return Array.from(this.candidates.values())
      .filter(c => c.healthFactor < threshold && c.lastDebtUsd1e18 >= minDebtUsd1e18);
  }

  /**
   * Check if user should be removed from risk set (with basic hysteresis)
   */
  shouldRemove(address: string): boolean {
    const candidate = this.get(address);
    if (!candidate) return false;
    
    const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
    const safeMargin = 1.10; // HF must be above 1.10 to be removed
    
    // Remove if debt is too low OR HF is safely above threshold
    return candidate.lastDebtUsd1e18 < minDebtUsd1e18 || candidate.healthFactor > safeMargin;
  }

  /**
   * Remove users that are no longer at risk (basic hysteresis)
   */
  pruneHealthyUsers(): number {
    let removed = 0;
    for (const [address, candidate] of this.candidates.entries()) {
      if (this.shouldRemove(address)) {
        this.candidates.delete(address);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get all users in the risk set
   */
  getAll(): CandidateUser[] {
    return Array.from(this.candidates.values());
  }

  /**
   * Get count of users in risk set
   */
  size(): number {
    return this.candidates.size;
  }

  /**
   * Remove a user from the risk set
   */
  remove(address: string): void {
    this.candidates.delete(address.toLowerCase());
  }

  /**
   * Clear all users
   */
  clear(): void {
    this.candidates.clear();
  }
}
