// risk/ActiveRiskSet.ts: Maintain at-risk users from on-chain HF checks

import { config } from '../config/index.js';

// Hysteresis: HF must be above this margin to be removed from risk set
const REMOVAL_HF_MARGIN = 1.10;

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
   * Enforces minimum debt requirement - users below MIN_DEBT_USD are not added
   */
  add(address: string, healthFactor: number, debtUsd1e18: bigint = 0n): void {
    const normalized = address.toLowerCase();
    
    // Enforce minimum debt at admission
    const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
    if (debtUsd1e18 > 0n && debtUsd1e18 < minDebtUsd1e18) {
      // Dust position - don't add to risk set
      return;
    }
    
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
   * Enforces minimum debt requirement - removes users that drop below MIN_DEBT_USD
   */
  updateHF(address: string, healthFactor: number, debtUsd1e18: bigint): void {
    const normalized = address.toLowerCase();
    const candidate = this.candidates.get(normalized);
    
    // Enforce minimum debt - remove dust positions
    const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
    if (debtUsd1e18 < minDebtUsd1e18) {
      // User dropped below minimum debt - remove from risk set
      if (candidate) {
        this.candidates.delete(normalized);
      }
      return;
    }
    
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
    
    // Remove if debt is too low OR HF is safely above threshold
    return candidate.lastDebtUsd1e18 < minDebtUsd1e18 || candidate.healthFactor > REMOVAL_HF_MARGIN;
  }

  /**
   * Remove users that are no longer at risk (basic hysteresis)
   */
  pruneHealthyUsers(): number {
    let removed = 0;
    for (const address of this.candidates.keys()) {
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
