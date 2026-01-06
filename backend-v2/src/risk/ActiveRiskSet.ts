// risk/ActiveRiskSet.ts: Maintain at-risk users from on-chain HF checks

import { config } from '../config/index.js';
import type { UserIndex } from '../predictive/UserIndex.js';
import type { ProtocolDataProvider } from '../aave/protocolDataProvider.js';
import { extractUserTokens } from '../predictive/tokenExtractor.js';

// Hysteresis: HF must be above this margin to be removed from risk set
const REMOVAL_HF_MARGIN = 1.10;

export interface CandidateUser {
  address: string;
  healthFactor: number;
  lastDebtUsd1e18: bigint;
  totalCollateralBase: bigint;
  lastChecked: number;
  lastIndexRefresh?: number; // Timestamp of last UserIndex refresh for this user
}

/**
 * ActiveRiskSet: Maintain a set of users who are at risk of liquidation
 * Built from on-chain HF checks, NOT subgraph triggers
 */
export class ActiveRiskSet {
  private candidates: Map<string, CandidateUser> = new Map();
  private userIndex: UserIndex | null = null;
  private dataProvider: ProtocolDataProvider | null = null;

  /**
   * Set the UserIndex for token-based user tracking
   */
  setUserIndex(userIndex: UserIndex): void {
    this.userIndex = userIndex;
  }
  
  /**
   * Set the ProtocolDataProvider for fetching user reserves
   */
  setDataProvider(dataProvider: ProtocolDataProvider): void {
    this.dataProvider = dataProvider;
  }

  /**
   * Get minimum debt threshold as 1e18-scaled BigInt
   */
  private getMinDebtThreshold(): bigint {
    return BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
  }

  /**
   * Add or update a user in the risk set
   * Enforces minimum debt requirement - users below MIN_DEBT_USD are not added
   */
  add(address: string, healthFactor: number, debtUsd1e18: bigint = 0n, totalCollateralBase: bigint = 0n): void {
    const normalized = address.toLowerCase();
    
    // Enforce minimum debt at admission
    const minDebtUsd1e18 = this.getMinDebtThreshold();
    if (debtUsd1e18 > 0n && debtUsd1e18 < minDebtUsd1e18) {
      // Dust position - don't add to risk set
      return;
    }
    
    this.candidates.set(normalized, {
      address: normalized,
      healthFactor,
      lastDebtUsd1e18: debtUsd1e18,
      totalCollateralBase,
      lastChecked: Date.now()
    });
    
    // Update UserIndex with actual user tokens (with throttling)
    if (this.userIndex && this.dataProvider) {
      this.updateUserIndexForUser(normalized).catch(err => {
        console.warn(`[risk] Failed to update UserIndex for ${normalized}:`, err instanceof Error ? err.message : err);
      });
    }
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
  updateHF(address: string, healthFactor: number, debtUsd1e18: bigint, totalCollateralBase: bigint = 0n): void {
    const normalized = address.toLowerCase();
    const candidate = this.candidates.get(normalized);
    
    // Enforce minimum debt - remove dust positions
    const minDebtUsd1e18 = this.getMinDebtThreshold();
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
      candidate.totalCollateralBase = totalCollateralBase;
      candidate.lastChecked = Date.now();
      
      // Update UserIndex with throttling to avoid hammering ProtocolDataProvider
      if (this.userIndex && this.dataProvider) {
        const now = Date.now();
        const lastRefresh = candidate.lastIndexRefresh || 0;
        const INDEX_REFRESH_THROTTLE_MS = 30000; // 30 seconds
        
        // Only refresh if enough time has passed
        if (now - lastRefresh >= INDEX_REFRESH_THROTTLE_MS) {
          candidate.lastIndexRefresh = now;
          this.updateUserIndexForUser(normalized).catch(err => {
            console.warn(`[risk] Failed to update UserIndex for ${normalized}:`, err instanceof Error ? err.message : err);
          });
        }
      }
    } else {
      // User not in set - add them (will call updateUserIndexForUser internally)
      this.add(normalized, healthFactor, debtUsd1e18, totalCollateralBase);
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
    const minDebtUsd1e18 = this.getMinDebtThreshold();
    
    return Array.from(this.candidates.values())
      .filter(c => c.healthFactor < threshold && c.lastDebtUsd1e18 >= minDebtUsd1e18);
  }

  /**
   * Check if user should be removed from risk set (with basic hysteresis)
   */
  shouldRemove(address: string): boolean {
    const candidate = this.get(address);
    if (!candidate) return false;
    
    const minDebtUsd1e18 = this.getMinDebtThreshold();
    
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

  /**
   * Update UserIndex with actual per-user token exposure
   */
  private async updateUserIndexForUser(userAddress: string): Promise<void> {
    if (!this.userIndex || !this.dataProvider) return;
    
    try {
      // Fetch user's actual reserves from Aave
      const reserves = await this.dataProvider.getAllUserReserves(userAddress);
      
      // Extract token addresses where user has exposure
      const tokenAddresses = extractUserTokens(reserves);
      
      // Update index (replaces previous tokens)
      this.userIndex.setUserTokens(userAddress, tokenAddresses);
    } catch (err) {
      // If extraction fails, don't index this user (safer than guessing)
      console.warn(`[risk] Token extraction failed for ${userAddress}, not indexing:`, err instanceof Error ? err.message : err);
    }
  }
}
