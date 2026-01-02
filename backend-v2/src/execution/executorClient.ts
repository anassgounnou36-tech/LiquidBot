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
   * Attempt liquidation with exact ABI call shape
   */
  async attemptLiquidation(params: LiquidationParams): Promise<ExecutionResult> {
    try {
      console.log('[executor] Sending liquidation tx:', {
        user: params.user,
        collateralAsset: params.collateralAsset,
        debtAsset: params.debtAsset,
        debtToCover: params.debtToCover.toString(),
        minOut: params.minOut.toString()
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
