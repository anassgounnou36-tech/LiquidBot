// pairSelector.ts: Minimal pair selection for liquidation

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';
import { config } from '../config/index.js';

/**
 * Pair selection result
 */
export interface PairSelection {
  collateralAsset: string;
  debtAsset: string;
  payout: string;
}

/**
 * PairSelector handles collateral/debt pair selection
 */
export class PairSelector {
  private provider: ethers.JsonRpcProvider;
  private uiPoolDataProviderAddress?: string;

  constructor() {
    this.provider = getHttpProvider();
    
    // Check for optional AAVE_UI_POOL_DATA_PROVIDER env var
    this.uiPoolDataProviderAddress = process.env.AAVE_UI_POOL_DATA_PROVIDER;
  }

  /**
   * Select collateral and debt assets for a user
   * Uses env overrides if provided, otherwise queries UI Pool Data Provider
   */
  async selectPair(user: string, payoutAddress: string): Promise<PairSelection | null> {
    // Check for env overrides first
    const envCollateral = process.env.COLLATERAL_ASSET;
    const envDebt = process.env.DEBT_ASSET;

    if (envCollateral && envDebt) {
      return {
        collateralAsset: envCollateral,
        debtAsset: envDebt,
        payout: payoutAddress
      };
    }

    // If UI Pool Data Provider is configured, query it
    if (this.uiPoolDataProviderAddress) {
      try {
        return await this.selectPairFromProvider(user, payoutAddress);
      } catch (err) {
        console.error(
          '[pairSelector] Failed to query UI Pool Data Provider:',
          err instanceof Error ? err.message : err
        );
        return null;
      }
    }

    // No pair selection method available
    console.warn('[pairSelector] No pair selection method configured (need env vars or UI provider)');
    return null;
  }

  /**
   * Query UI Pool Data Provider for user reserves
   */
  private async selectPairFromProvider(
    user: string,
    payoutAddress: string
  ): Promise<PairSelection | null> {
    if (!this.uiPoolDataProviderAddress) {
      throw new Error('UI Pool Data Provider not configured');
    }

    const providerContract = new ethers.Contract(
      this.uiPoolDataProviderAddress,
      [
        'function getUserReservesData(address provider, address user) external view returns (tuple(address underlyingAsset, uint256 scaledATokenBalance, bool usageAsCollateralEnabledOnUser, uint256 stableBorrowRate, uint256 scaledVariableDebt, uint256 principalStableDebt, uint256 stableBorrowLastUpdateTimestamp)[] memory)'
      ],
      this.provider
    );

    const reserves = await providerContract.getUserReservesData(
      config.AAVE_POOL_ADDRESS,
      user
    );

    // Find largest collateral and debt
    let largestCollateral: { asset: string; balance: bigint } | null = null;
    let largestDebt: { asset: string; amount: bigint } | null = null;

    for (const reserve of reserves) {
      const asset = reserve.underlyingAsset;
      const collateralBalance = BigInt(reserve.scaledATokenBalance.toString());
      const debtAmount = BigInt(reserve.scaledVariableDebt.toString());

      if (reserve.usageAsCollateralEnabledOnUser && collateralBalance > 0n) {
        if (!largestCollateral || collateralBalance > largestCollateral.balance) {
          largestCollateral = { asset, balance: collateralBalance };
        }
      }

      if (debtAmount > 0n) {
        if (!largestDebt || debtAmount > largestDebt.amount) {
          largestDebt = { asset, amount: debtAmount };
        }
      }
    }

    if (!largestCollateral || !largestDebt) {
      return null;
    }

    return {
      collateralAsset: largestCollateral.asset,
      debtAsset: largestDebt.asset,
      payout: payoutAddress
    };
  }
}
