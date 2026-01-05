// risk/HealthFactorChecker.ts: Batch HF checks using Multicall3

import { Contract, Interface } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';
import { config } from '../config/index.js';
import { getUsdPrice } from '../prices/priceMath.js';

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

// Multicall3 address on Base
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

export interface HealthFactorResult {
  address: string;
  healthFactor: number;
  totalDebtBase: bigint;
  totalCollateralBase: bigint;
  debtUsd1e18: bigint;
}

/**
 * HealthFactorChecker: Batch check health factors using Multicall3
 */
export class HealthFactorChecker {
  private multicall3: Contract;
  private aavePoolInterface: Interface;

  constructor() {
    const provider = getHttpProvider();
    this.multicall3 = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    this.aavePoolInterface = new Interface(AAVE_POOL_ABI);
  }

  /**
   * Check health factors for multiple users in a single multicall
   * @param addresses User addresses to check
   * @param batchSize Number of users per batch (default 100)
   */
  async checkBatch(addresses: string[], batchSize = 100): Promise<HealthFactorResult[]> {
    const results: HealthFactorResult[] = [];
    
    // Process in batches
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const batchResults = await this.checkSingleBatch(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Check a single batch of users
   */
  private async checkSingleBatch(addresses: string[]): Promise<HealthFactorResult[]> {
    // Build multicall calls
    const calls = addresses.map(addr => ({
      target: config.AAVE_POOL_ADDRESS,
      allowFailure: true,
      callData: this.aavePoolInterface.encodeFunctionData('getUserAccountData', [addr])
    }));

    // Execute multicall
    const results = await this.multicall3.aggregate3.staticCall(calls);
    
    // Parse results
    const healthFactors: HealthFactorResult[] = [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const address = addresses[i];
      
      if (result.success) {
        try {
          const decoded = this.aavePoolInterface.decodeFunctionResult(
            'getUserAccountData',
            result.returnData
          );
          
          const totalCollateralBase = decoded[0];
          const totalDebtBase = decoded[1];
          const healthFactorRaw = decoded[5];
          
          // Convert HF from ray (18 decimals) to float (for logging only)
          // CRITICAL: Sanitize edge cases to avoid false minHF=0.0000
          let healthFactor: number;
          
          if (totalDebtBase === 0n) {
            // No debt: HF is effectively infinite (user cannot be liquidated)
            healthFactor = Infinity;
          } else if (healthFactorRaw === 0n) {
            // Invalid/edge-case HF: treat as Infinity (user with collateral but zero calculated HF)
            healthFactor = Infinity;
          } else {
            // Normal case: convert HF from ray (1e18) to float
            healthFactor = Number(healthFactorRaw) / 1e18;
          }
          
          // Calculate debtUsd1e18 from totalDebtBase correctly based on base currency
          let debtUsd1e18: bigint;
          
          if (config.AAVE_BASE_CURRENCY_IS_USD) {
            // Base currency is USD: just normalize decimals
            const baseDecimals = config.AAVE_BASE_CURRENCY_DECIMALS;
            if (baseDecimals === 18) {
              debtUsd1e18 = totalDebtBase;
            } else if (baseDecimals < 18) {
              const exponent = 18 - baseDecimals;
              debtUsd1e18 = totalDebtBase * (10n ** BigInt(exponent));
            } else {
              const exponent = baseDecimals - 18;
              debtUsd1e18 = totalDebtBase / (10n ** BigInt(exponent));
            }
          } else {
            // Base currency is ETH (or other): convert via price
            // Get ETH USD price once for this batch (should be cached from first call)
            const ethUsd1e18 = await getUsdPrice('ETH');
            
            // Normalize totalDebtBase to 1e18
            const baseDecimals = config.AAVE_BASE_CURRENCY_DECIMALS;
            let totalDebtBase1e18: bigint;
            if (baseDecimals === 18) {
              totalDebtBase1e18 = totalDebtBase;
            } else if (baseDecimals < 18) {
              const exponent = 18 - baseDecimals;
              totalDebtBase1e18 = totalDebtBase * (10n ** BigInt(exponent));
            } else {
              const exponent = baseDecimals - 18;
              totalDebtBase1e18 = totalDebtBase / (10n ** BigInt(exponent));
            }
            
            // Convert to USD
            debtUsd1e18 = (totalDebtBase1e18 * ethUsd1e18) / (10n ** 18n);
          }
          
          healthFactors.push({
            address,
            healthFactor,
            totalDebtBase,
            totalCollateralBase,
            debtUsd1e18
          });
        } catch (err) {
          console.warn(`[hf-checker] Failed to decode result for ${address}:`, err);
        }
      }
    }
    
    return healthFactors;
  }

  /**
   * Check health factor for a single user
   */
  async checkSingle(address: string): Promise<HealthFactorResult | null> {
    const results = await this.checkBatch([address]);
    return results[0] || null;
  }
}
