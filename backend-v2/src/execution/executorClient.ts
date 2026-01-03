// executorClient.ts: Executor contract client with exact ABI from old bot

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';
import { TxBroadcaster } from './txBroadcaster.js';
import { computeMinRequiredOut, FLASHLOAN_FEE_BPS, SAFETY_BUFFER_BPS } from './safety.js';

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
 * Execution result with status discrimination
 */
export type ExecutionResult =
  | { status: 'mined'; txHash: string; receipt: ethers.TransactionReceipt }
  | { status: 'pending'; txHash: string }
  | { status: 'failed'; error: string; txHash?: string };

/**
 * ExecutorClient handles communication with the LiquidationExecutor contract
 */
export class ExecutorClient {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private executorAddress: string;
  private contract: ethers.Contract;
  private broadcaster: TxBroadcaster | null = null;

  constructor(executorAddress: string, privateKey: string, broadcastRpcUrls?: string[]) {
    this.provider = getHttpProvider();
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.executorAddress = executorAddress;
    
    // Initialize broadcaster if multiple RPCs provided
    if (broadcastRpcUrls && broadcastRpcUrls.length > 1) {
      this.broadcaster = new TxBroadcaster({
        rpcUrls: broadcastRpcUrls,
        replacementDelayMs: 3000,
        maxReplacements: 3,
        priorityFeeBumpPercent: 20
      });
      console.log(`[executor] Multi-RPC broadcast enabled with ${broadcastRpcUrls.length} RPCs`);
    }

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
   * Uses repayment correctness: minOut must cover debtToCover + fees + buffer
   */
  private performSafetyChecks(params: LiquidationParams): SafetyCheckResult {
    // Check 1: debtToCover must be > 0
    if (params.debtToCover <= 0n) {
      return {
        safe: false,
        reason: 'debtToCover must be > 0'
      };
    }
    
    // Check 2: expectedCollateralOut must be > 0 if provided
    if (params.expectedCollateralOut !== undefined && params.expectedCollateralOut <= 0n) {
      return {
        safe: false,
        reason: 'expectedCollateralOut must be > 0'
      };
    }
    
    // Check 3: Repayment correctness - minOut must cover debt + fees + buffer
    // minOut is in debt token units, representing what we get from swapping collateral
    // It must be enough to repay debtToCover + flashloan fee + safety margin
    const minRequiredOut = computeMinRequiredOut(params.debtToCover, FLASHLOAN_FEE_BPS, SAFETY_BUFFER_BPS);
    const flashloanFee = (params.debtToCover * BigInt(FLASHLOAN_FEE_BPS)) / 10000n;
    const safetyBuffer = (params.debtToCover * BigInt(SAFETY_BUFFER_BPS)) / 10000n;
    
    if (params.minOut < minRequiredOut) {
      return {
        safe: false,
        reason: `Repayment check failed: minOut (${params.minOut.toString()}) < required (${minRequiredOut.toString()}). ` +
                `Required = debtToCover (${params.debtToCover.toString()}) + fee (${flashloanFee.toString()}) + buffer (${safetyBuffer.toString()})`
      };
    }
    
    return { safe: true };
  }

  /**
   * Attempt liquidation with exact ABI call shape
   * Includes safety checks before sending transaction
   * Uses multi-RPC broadcast if configured
   */
  async attemptLiquidation(params: LiquidationParams): Promise<ExecutionResult> {
    try {
      // Perform safety checks first
      const safetyCheck = this.performSafetyChecks(params);
      if (!safetyCheck.safe) {
        console.error('[executor] Safety check failed:', safetyCheck.reason);
        return { 
          status: 'failed',
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

      // Build transaction request
      const txRequest: ethers.TransactionRequest = await this.contract.initiateLiquidation.populateTransaction(
        {
          user: params.user,
          collateralAsset: params.collateralAsset,
          debtAsset: params.debtAsset,
          debtToCover: params.debtToCover,
          oneInchCalldata: params.oneInchCalldata,
          minOut: params.minOut,
          payout: params.payout
        }
      );

      // Add gas settings
      txRequest.maxPriorityFeePerGas = maxPriorityFeePerGas;
      txRequest.maxFeePerGas = maxFeePerGas;

      // Use broadcaster if available, otherwise send normally
      if (this.broadcaster) {
        console.log('[executor] Using multi-RPC broadcast with replacement strategy');
        const result = await this.broadcaster.broadcastWithReplacement(this.wallet, txRequest);
        
        if (result.status === 'mined') {
          console.log('[executor] Transaction confirmed:', result.txHash);
          return { status: 'mined', txHash: result.txHash, receipt: result.receipt };
        } else if (result.status === 'pending') {
          console.warn('[executor] Transaction still pending after max retries:', result.txHash);
          return { status: 'pending', txHash: result.txHash };
        } else {
          console.error('[executor] Broadcast failed:', result.error);
          return { 
            status: 'failed',
            error: result.error,
            txHash: result.lastTxHash
          };
        }
      } else {
        // Single RPC path (legacy)
        console.log('[executor] Using single RPC (no multi-broadcast)');
        const tx = await this.wallet.sendTransaction(txRequest);
        console.log('[executor] Transaction sent:', tx.hash);

        // Wait for confirmation
        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
          console.log('[executor] Transaction confirmed:', receipt.hash);
          return { status: 'mined', txHash: receipt.hash, receipt };
        } else {
          console.error('[executor] Transaction reverted:', receipt?.hash);
          return { status: 'failed', error: 'Transaction reverted', txHash: receipt?.hash };
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[executor] Execution failed:', errorMsg);
      return { status: 'failed', error: errorMsg };
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
