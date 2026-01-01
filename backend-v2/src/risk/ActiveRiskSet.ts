// risk/ActiveRiskSet.ts: Maintain at-risk users from on-chain HF checks

import { config } from '../config/index.js';

export interface CandidateUser {
  address: string;
  healthFactor: number;
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
  add(address: string, healthFactor: number): void {
    const normalized = address.toLowerCase();
    
    this.candidates.set(normalized, {
      address: normalized,
      healthFactor,
      lastChecked: Date.now()
    });
  }

  /**
   * Add multiple users in bulk
   */
  addBulk(addresses: string[]): void {
    for (const address of addresses) {
      // Initialize with HF = Infinity (unchecked)
      this.add(address, Infinity);
    }
  }

  /**
   * Update health factor for a user
   */
  updateHF(address: string, healthFactor: number): void {
    const normalized = address.toLowerCase();
    const candidate = this.candidates.get(normalized);
    
    if (candidate) {
      candidate.healthFactor = healthFactor;
      candidate.lastChecked = Date.now();
    } else {
      this.add(normalized, healthFactor);
    }
  }

  /**
   * Get a user from the risk set
   */
  get(address: string): CandidateUser | undefined {
    return this.candidates.get(address.toLowerCase());
  }

  /**
   * Get all users below HF threshold
   */
  getBelowThreshold(): CandidateUser[] {
    const threshold = config.HF_THRESHOLD_START;
    return Array.from(this.candidates.values())
      .filter(c => c.healthFactor < threshold);
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
