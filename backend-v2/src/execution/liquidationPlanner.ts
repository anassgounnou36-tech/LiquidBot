// execution/liquidationPlanner.ts: Plan liquidations with correct token units and amounts

import { ethers } from 'ethers';
import { ProtocolDataProvider, type UserReserveData } from '../aave/protocolDataProvider.js';
import { getUsdPrice } from '../prices/priceMath.js';
import { getHttpProvider } from '../providers/rpc.js';

/**
 * Liquidation plan with all amounts in correct token units
 */
export interface LiquidationPlan {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: bigint; // In debt token units
  expectedCollateralOut: bigint; // In collateral token units
  debtAssetDecimals: number;
  collateralAssetDecimals: number;
  liquidationBonusBps: number;
}

/**
 * LiquidationPlanner: Compute liquidation parameters with correct token units
 */
export class LiquidationPlanner {
  private dataProvider: ProtocolDataProvider;
  private provider: ethers.JsonRpcProvider;

  constructor(dataProviderAddress: string) {
    this.dataProvider = new ProtocolDataProvider(dataProviderAddress);
    this.provider = getHttpProvider();
  }

  /**
   * Build a complete liquidation plan for a user
   * Computes debtToCover and expectedCollateralOut in correct token units
   */
  async buildPlan(user: string): Promise<LiquidationPlan | null> {
    // Get all user reserves
    const reserves = await this.dataProvider.getAllUserReserves(user);
    
    if (reserves.length === 0) {
      console.warn(`[liquidationPlanner] No reserves found for user ${user}`);
      return null;
    }

    // Step 1: Find user's debt positions
    const debtPositions = reserves.filter(
      r => r.currentVariableDebt > 0n || r.currentStableDebt > 0n
    );

    if (debtPositions.length === 0) {
      console.warn(`[liquidationPlanner] No debt positions for user ${user}`);
      return null;
    }

    // Step 2: Find user's collateral positions
    const collateralPositions = reserves.filter(
      r => r.usageAsCollateralEnabled && r.currentATokenBalance > 0n
    );

    if (collateralPositions.length === 0) {
      console.warn(`[liquidationPlanner] No collateral positions for user ${user}`);
      return null;
    }

    // Step 3: Select best debt and collateral pair by USD value
    const bestPair = await this.selectBestPair(debtPositions, collateralPositions);
    
    if (!bestPair) {
      console.warn(`[liquidationPlanner] Could not select pair for user ${user}`);
      return null;
    }

    const { debtReserve, collateralReserve } = bestPair;

    // Step 4: Get token decimals
    const debtTokenContract = new ethers.Contract(
      debtReserve.underlyingAsset,
      ['function decimals() external view returns (uint8)'],
      this.provider
    );
    const collateralTokenContract = new ethers.Contract(
      collateralReserve.underlyingAsset,
      ['function decimals() external view returns (uint8)'],
      this.provider
    );

    const debtDecimals = Number(await debtTokenContract.decimals());
    const collateralDecimals = Number(await collateralTokenContract.decimals());

    // Step 5: Calculate total debt in token units
    const totalDebtTokenAmount = debtReserve.currentVariableDebt + debtReserve.currentStableDebt;

    // Step 6: Apply close factor (fixed 50% = 5000 BPS)
    const CLOSE_FACTOR_BPS = 5000n;
    const debtToCover = (totalDebtTokenAmount * CLOSE_FACTOR_BPS) / 10000n;

    console.log(
      `[liquidationPlanner] Debt to cover: ${debtToCover.toString()} (50% of ${totalDebtTokenAmount.toString()})`
    );

    // Step 7: Get liquidation bonus for collateral asset
    const collateralConfig = await this.dataProvider.getReserveConfigurationData(
      collateralReserve.underlyingAsset
    );
    
    // Aave liquidation bonus is in basis points (e.g., 10500 = 105% = 5% bonus)
    // We need just the bonus part (e.g., 500 BPS = 5%)
    const liquidationBonusBps = collateralConfig.liquidationBonus > 10000 
      ? collateralConfig.liquidationBonus - 10000
      : 500; // Fallback to 5% if format is different

    console.log(
      `[liquidationPlanner] Liquidation bonus: ${liquidationBonusBps} BPS (${liquidationBonusBps / 100}%)`
    );

    // Step 8: Calculate expected collateral seized
    // Formula: collateralOut = debtToCover * debtPrice / collateralPrice * (1 + bonus)
    const expectedCollateralOut = await this.calculateExpectedCollateral(
      debtToCover,
      debtReserve.underlyingAsset,
      debtDecimals,
      collateralReserve.underlyingAsset,
      collateralDecimals,
      liquidationBonusBps
    );

    console.log(
      `[liquidationPlanner] Expected collateral out: ${expectedCollateralOut.toString()} (with ${liquidationBonusBps / 100}% bonus)`
    );

    return {
      user,
      debtAsset: debtReserve.underlyingAsset,
      collateralAsset: collateralReserve.underlyingAsset,
      debtToCover,
      expectedCollateralOut,
      debtAssetDecimals: debtDecimals,
      collateralAssetDecimals: collateralDecimals,
      liquidationBonusBps
    };
  }

  /**
   * Select best debt and collateral pair by USD value
   */
  private async selectBestPair(
    debtPositions: UserReserveData[],
    collateralPositions: UserReserveData[]
  ): Promise<{ debtReserve: UserReserveData; collateralReserve: UserReserveData } | null> {
    let bestPair: { debtReserve: UserReserveData; collateralReserve: UserReserveData; debtUsd: bigint } | null = null;

    // For each debt position, find corresponding collateral
    for (const debtReserve of debtPositions) {
      const totalDebt = debtReserve.currentVariableDebt + debtReserve.currentStableDebt;
      
      try {
        // Get debt USD value (simplified: use address as lookup key)
        // In production, you'd map address to symbol
        const debtUsd = await this.estimateUsdValue(
          debtReserve.underlyingAsset,
          totalDebt
        );

        // Find largest collateral position
        for (const collateralReserve of collateralPositions) {
          if (!bestPair || debtUsd > bestPair.debtUsd) {
            bestPair = {
              debtReserve,
              collateralReserve,
              debtUsd
            };
          }
        }
      } catch (err) {
        console.warn(
          `[liquidationPlanner] Failed to get USD value for debt asset ${debtReserve.underlyingAsset}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return bestPair ? { debtReserve: bestPair.debtReserve, collateralReserve: bestPair.collateralReserve } : null;
  }

  /**
   * Calculate expected collateral seized
   * All math in BigInt with proper decimal scaling
   */
  private async calculateExpectedCollateral(
    debtToCover: bigint,
    debtAsset: string,
    debtDecimals: number,
    collateralAsset: string,
    collateralDecimals: number,
    liquidationBonusBps: number
  ): Promise<bigint> {
    // Get prices (1e18 scaled)
    const debtPriceUsd1e18 = await getUsdPrice(await this.getSymbolForAddress(debtAsset));
    const collateralPriceUsd1e18 = await getUsdPrice(await this.getSymbolForAddress(collateralAsset));

    // Convert debtToCover to 1e18 scale
    let debtToCover1e18: bigint;
    if (debtDecimals === 18) {
      debtToCover1e18 = debtToCover;
    } else if (debtDecimals < 18) {
      debtToCover1e18 = debtToCover * (10n ** BigInt(18 - debtDecimals));
    } else {
      debtToCover1e18 = debtToCover / (10n ** BigInt(debtDecimals - 18));
    }

    // Calculate debt value in USD (1e18 scale)
    const debtValueUsd1e18 = (debtToCover1e18 * debtPriceUsd1e18) / (10n ** 18n);

    // Calculate collateral amount needed (1e18 scale)
    const collateralAmount1e18 = (debtValueUsd1e18 * (10n ** 18n)) / collateralPriceUsd1e18;

    // Apply liquidation bonus
    const collateralWithBonus1e18 = (collateralAmount1e18 * (10000n + BigInt(liquidationBonusBps))) / 10000n;

    // Convert back to collateral token decimals
    let collateralOut: bigint;
    if (collateralDecimals === 18) {
      collateralOut = collateralWithBonus1e18;
    } else if (collateralDecimals < 18) {
      collateralOut = collateralWithBonus1e18 / (10n ** BigInt(18 - collateralDecimals));
    } else {
      collateralOut = collateralWithBonus1e18 * (10n ** BigInt(collateralDecimals - 18));
    }

    return collateralOut;
  }

  /**
   * Get symbol for token address
   * TODO: Implement proper address-to-symbol mapping
   * For now, try to query token contract or use fallback
   */
  private async getSymbolForAddress(address: string): Promise<string> {
    try {
      const tokenContract = new ethers.Contract(
        address,
        ['function symbol() external view returns (string)'],
        this.provider
      );
      return await tokenContract.symbol();
    } catch (err) {
      // Fallback: return address if symbol query fails
      console.warn(`[liquidationPlanner] Could not get symbol for ${address}, using address`);
      return address;
    }
  }

  /**
   * Estimate USD value of a token amount
   */
  private async estimateUsdValue(asset: string, amount: bigint): Promise<bigint> {
    const symbol = await this.getSymbolForAddress(asset);
    const priceUsd1e18 = await getUsdPrice(symbol);
    
    // Get token decimals
    const tokenContract = new ethers.Contract(
      asset,
      ['function decimals() external view returns (uint8)'],
      this.provider
    );
    const decimals = Number(await tokenContract.decimals());

    // Normalize amount to 1e18
    let amount1e18: bigint;
    if (decimals === 18) {
      amount1e18 = amount;
    } else if (decimals < 18) {
      amount1e18 = amount * (10n ** BigInt(18 - decimals));
    } else {
      amount1e18 = amount / (10n ** BigInt(decimals - 18));
    }

    // Calculate USD value
    return (amount1e18 * priceUsd1e18) / (10n ** 18n);
  }
}
