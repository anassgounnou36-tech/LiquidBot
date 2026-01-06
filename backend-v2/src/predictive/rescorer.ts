// predictive/rescorer.ts: Predictive HF re-scoring using cached prices
// Re-scores users' health factors when Pyth prices update

import type { HealthFactorChecker } from '../risk/HealthFactorChecker.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';
import { config } from '../config/index.js';

/**
 * Rescorer: Re-score health factors predictively when prices change
 */
export class Rescorer {
  private hfChecker: HealthFactorChecker;
  private riskSet: ActiveRiskSet;
  private minDebtUsd1e18: bigint;

  constructor(hfChecker: HealthFactorChecker, riskSet: ActiveRiskSet) {
    this.hfChecker = hfChecker;
    this.riskSet = riskSet;
    // Pre-compute minimum debt threshold to avoid repeated computation
    this.minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
  }

  /**
   * Re-score a batch of users using prediction prices
   * @param users Array of user addresses
   * @returns Promise<number> Number of users successfully re-scored
   */
  async rescoreBatch(users: string[]): Promise<number> {
    if (users.length === 0) {
      return 0;
    }

    try {
      // Check health factors for all users
      const results = await this.hfChecker.checkBatch(users, 100);
      
      // Update risk set with new HFs
      let rescored = 0;
      for (const result of results) {
        this.riskSet.updateHF(result.address, result.healthFactor, result.debtUsd1e18);
        rescored++;
      }
      
      return rescored;
    } catch (err) {
      console.error(
        `[rescorer] Failed to re-score batch of ${users.length} users:`,
        err instanceof Error ? err.message : err
      );
      return 0;
    }
  }

  /**
   * Re-score a single user
   * @param user User address
   * @returns Promise<boolean> True if successfully re-scored
   */
  async rescoreUser(user: string): Promise<boolean> {
    try {
      const result = await this.hfChecker.checkSingle(user);
      
      if (!result) {
        return false;
      }
      
      this.riskSet.updateHF(result.address, result.healthFactor, result.debtUsd1e18);
      
      // Check if user needs execution
      if (result.healthFactor <= config.HF_THRESHOLD_EXECUTE && result.debtUsd1e18 >= this.minDebtUsd1e18) {
        return true; // Needs execution
      }
      
      return false;
    } catch (err) {
      console.error(
        `[rescorer] Failed to re-score user ${user}:`,
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }
}
