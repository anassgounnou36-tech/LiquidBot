// aave/protocolDataProvider.ts: Query Aave Protocol Data Provider for user reserves

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';

/**
 * User reserve data from Protocol Data Provider
 */
export interface UserReserveData {
  underlyingAsset: string;
  currentATokenBalance: bigint;
  currentStableDebt: bigint;
  currentVariableDebt: bigint;
  principalStableDebt: bigint;
  scaledVariableDebt: bigint;
  stableBorrowRate: bigint;
  liquidityRate: bigint;
  stableRateLastUpdated: number;
  usageAsCollateralEnabled: boolean;
}

/**
 * Reserve token info
 */
export interface ReserveToken {
  symbol: string;
  tokenAddress: string;
}

/**
 * ProtocolDataProvider: Query Aave Protocol Data Provider for current user reserves
 */
export class ProtocolDataProvider {
  private provider: ethers.JsonRpcProvider;
  private dataProviderAddress: string;
  private contract: ethers.Contract;

  constructor(dataProviderAddress: string) {
    this.provider = getHttpProvider();
    this.dataProviderAddress = dataProviderAddress;
    
    // Protocol Data Provider ABI
    this.contract = new ethers.Contract(
      dataProviderAddress,
      [
        'function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
        'function getAllReservesTokens() external view returns (tuple(string symbol, address tokenAddress)[])',
        'function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)'
      ],
      this.provider
    );
  }

  /**
   * Get user reserve data for a specific asset
   */
  async getUserReserveData(asset: string, user: string): Promise<UserReserveData> {
    const result = await this.contract.getUserReserveData(asset, user);
    
    return {
      underlyingAsset: asset,
      currentATokenBalance: BigInt(result.currentATokenBalance.toString()),
      currentStableDebt: BigInt(result.currentStableDebt.toString()),
      currentVariableDebt: BigInt(result.currentVariableDebt.toString()),
      principalStableDebt: BigInt(result.principalStableDebt.toString()),
      scaledVariableDebt: BigInt(result.scaledVariableDebt.toString()),
      stableBorrowRate: BigInt(result.stableBorrowRate.toString()),
      liquidityRate: BigInt(result.liquidityRate.toString()),
      stableRateLastUpdated: Number(result.stableRateLastUpdated),
      usageAsCollateralEnabled: result.usageAsCollateralEnabled
    };
  }

  /**
   * Get all user reserves (all assets in the pool)
   */
  async getAllUserReserves(user: string): Promise<UserReserveData[]> {
    // Get all reserve tokens
    const allReserves = await this.contract.getAllReservesTokens();
    
    const reserves: UserReserveData[] = [];
    
    // Query each reserve for user data
    for (const reserve of allReserves) {
      const tokenAddress = reserve.tokenAddress;
      
      try {
        const userReserve = await this.getUserReserveData(tokenAddress, user);
        
        // Only include if user has balance or debt
        if (
          userReserve.currentATokenBalance > 0n ||
          userReserve.currentStableDebt > 0n ||
          userReserve.currentVariableDebt > 0n
        ) {
          reserves.push(userReserve);
        }
      } catch (err) {
        console.warn(
          `[protocolDataProvider] Failed to query reserve ${reserve.symbol}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    
    return reserves;
  }

  /**
   * Get reserve configuration data including liquidation bonus
   */
  async getReserveConfigurationData(asset: string): Promise<{
    decimals: number;
    ltv: number;
    liquidationThreshold: number;
    liquidationBonus: number;
    reserveFactor: number;
    usageAsCollateralEnabled: boolean;
    borrowingEnabled: boolean;
    stableBorrowRateEnabled: boolean;
    isActive: boolean;
    isFrozen: boolean;
  }> {
    const result = await this.contract.getReserveConfigurationData(asset);
    
    return {
      decimals: Number(result.decimals),
      ltv: Number(result.ltv),
      liquidationThreshold: Number(result.liquidationThreshold),
      liquidationBonus: Number(result.liquidationBonus),
      reserveFactor: Number(result.reserveFactor),
      usageAsCollateralEnabled: result.usageAsCollateralEnabled,
      borrowingEnabled: result.borrowingEnabled,
      stableBorrowRateEnabled: result.stableBorrowRateEnabled,
      isActive: result.isActive,
      isFrozen: result.isFrozen
    };
  }

  /**
   * Get all reserve tokens
   */
  async getAllReservesTokens(): Promise<ReserveToken[]> {
    const result = await this.contract.getAllReservesTokens();
    return result.map((r: any) => ({
      symbol: r.symbol,
      tokenAddress: r.tokenAddress
    }));
  }
}
