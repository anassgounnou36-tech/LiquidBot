// executorClient.ts: Executor contract client with exact ABI from old bot

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';

/**
 * Liquidation parameters matching the exact struct from ExecutionService.ts
 */
export interface LiquidationParams {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  oneInchCalldata: string;
  minOut: bigint;
  payout: string;
  expectedCollateralOut?: bigint; // Optional for safety checks
}

/**
 * Safety check result
 */
interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * ExecutorClient handles communication with the LiquidationExecutor contract
 */
export class ExecutorClient {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private executorAddress: string;
  private contract: ethers.Contract;

  constructor(executorAddress: string, privateKey: string) {
    this.provider = getHttpProvider();
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.executorAddress = executorAddress;

    // Exact ABI from old bot's ExecutionService.ts
    const executorAbi = [
      'function initiateLiquidation((address user, address collateralAsset, address debtAsset, uint256 debtToCover, bytes oneInchCalldata, uint256 minOut, address payout) params) external'
    ];

    this.contract = new ethers.Contract(
      executorAddress,
      executorAbi,
      this.wallet
    );
  }

  /**
   * Perform safety checks before sending transaction
   */
  private performSafetyChecks(params: LiquidationParams): SafetyCheckResult {
    const MAX_SLIPPAGE_BPS = 500; // 5% max slippage
    
    // Check 1: expectedCollateralOut must be > 0
    if (params.expectedCollateralOut !== undefined && params.expectedCollateralOut <= 0n) {
      return {
        safe: false,
        reason: 'expectedCollateralOut must be > 0'
      };
    }
    
    // Check 2: minOut must be > debtToCover (otherwise we lose money)
    if (params.minOut <= params.debtToCover) {
      return {
        safe: false,
        reason: `minOut (${params.minOut.toString()}) must be > debtToCover (${params.debtToCover.toString()})`
      };
    }
    
    // Check 3: slippage check - minOut should be close to expectedCollateralOut
    if (params.expectedCollateralOut !== undefined) {
      const slippageAmount = params.expectedCollateralOut - params.minOut;
      const slippageBps = (slippageAmount * 10000n) / params.expectedCollateralOut;
      
      if (slippageBps > BigInt(MAX_SLIPPAGE_BPS)) {
        return {
          safe: false,
          reason: `Slippage too high: ${slippageBps.toString()} BPS (max ${MAX_SLIPPAGE_BPS})`
        };
      }
    }
    
    // Check 4: debtToCover must be > 0
    if (params.debtToCover <= 0n) {
      return {
        safe: false,
        reason: 'debtToCover must be > 0'
      };
    }
    
    return { safe: true };
  }

  /**
   * Attempt liquidation with exact ABI call shape
   * Includes safety checks before sending transaction
   */
  async attemptLiquidation(params: LiquidationParams): Promise<ExecutionResult> {
    try {
      // Perform safety checks first
      const safetyCheck = this.performSafetyChecks(params);
      if (!safetyCheck.safe) {
        console.error('[executor] Safety check failed:', safetyCheck.reason);
        return { 
          success: false, 
          error: `Safety check failed: ${safetyCheck.reason}` 
        };
      }
      
      console.log('[executor] Safety checks passed');
      console.log('[executor] Sending liquidation tx:', {
        user: params.user,
        collateralAsset: params.collateralAsset,
        debtAsset: params.debtAsset,
        debtToCover: params.debtToCover.toString(),
        minOut: params.minOut.toString(),
        expectedCollateralOut: params.expectedCollateralOut?.toString() || 'N/A'
      });

      // Get current base fee and priority fee
      const feeData = await this.provider.getFeeData();
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');
      const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei');

      // Call initiateLiquidation with exact struct format
      const tx = await this.contract.initiateLiquidation(
        {
          user: params.user,
          collateralAsset: params.collateralAsset,
          debtAsset: params.debtAsset,
          debtToCover: params.debtToCover,
          oneInchCalldata: params.oneInchCalldata,
          minOut: params.minOut,
          payout: params.payout
        },
        {
          maxPriorityFeePerGas,
          maxFeePerGas
        }
      );

      console.log('[executor] Transaction sent:', tx.hash);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log('[executor] Transaction confirmed:', receipt.hash);
        return { success: true, txHash: receipt.hash };
      } else {
        console.error('[executor] Transaction reverted:', receipt.hash);
        return { success: false, txHash: receipt.hash, error: 'Transaction reverted' };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[executor] Execution failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get executor address
   */
  getAddress(): string {
    return this.executorAddress;
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    return this.wallet.address;
  }
}
