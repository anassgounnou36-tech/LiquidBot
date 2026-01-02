// execution/executorClient.ts: Execute liquidations via deployed flashloan executor
// Uses exact ABI signature from old bot

import { JsonRpcProvider, Wallet, Contract } from 'ethers';

// Executor ABI - EXACT match from old bot (ExecutionService.ts line 1360-1366)
const EXECUTOR_ABI = [
  'function initiateLiquidation((address user, address collateralAsset, address debtAsset, uint256 debtToCover, bytes oneInchCalldata, uint256 minOut, address payout) params) external'
];

export interface LiquidationParams {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  oneInchCalldata: string;
  minOut: bigint;
  payout: string;
}

export interface LiquidationResult {
  success: boolean;
  txHash?: string;
  reason?: string;
}

/**
 * Attempt a liquidation via the deployed executor contract
 * 
 * Submits a simple EIP-1559 transaction to the public RPC.
 * No mempool sniping or private bundles.
 * 
 * @param params Liquidation parameters
 * @returns Execution result
 */
export async function attemptLiquidation(params: LiquidationParams): Promise<LiquidationResult> {
  const rpc = process.env.RPC_URL;
  const pk = process.env.EXECUTION_PRIVATE_KEY;
  const execAddr = process.env.EXECUTOR_ADDRESS;

  // Validate config
  if (!rpc || !pk || !execAddr) {
    return {
      success: false,
      reason: 'missing_config: RPC_URL, EXECUTION_PRIVATE_KEY, or EXECUTOR_ADDRESS'
    };
  }

  try {
    // Setup provider and wallet
    const provider = new JsonRpcProvider(rpc);
    const wallet = new Wallet(pk, provider);
    const contract = new Contract(execAddr, EXECUTOR_ABI, wallet);

    console.log('[executor-client] Submitting liquidation transaction:', {
      user: params.user,
      debtAsset: params.debtAsset,
      collateralAsset: params.collateralAsset,
      debtToCover: params.debtToCover.toString()
    });

    // Call initiateLiquidation with params struct
    const tx = await contract.initiateLiquidation({
      user: params.user,
      collateralAsset: params.collateralAsset,
      debtAsset: params.debtAsset,
      debtToCover: params.debtToCover,
      oneInchCalldata: params.oneInchCalldata,
      minOut: params.minOut,
      payout: params.payout
    });

    console.log('[executor-client] Transaction sent:', tx.hash);

    // Wait for confirmation
    const receipt = await tx.wait();

    if (!receipt) {
      return {
        success: false,
        txHash: tx.hash,
        reason: 'no_receipt'
      };
    }

    const success = receipt.status === 1;

    console.log('[executor-client] Transaction confirmed:', {
      txHash: tx.hash,
      status: success ? 'success' : 'reverted',
      gasUsed: receipt.gasUsed.toString()
    });

    return {
      success,
      txHash: tx.hash,
      reason: success ? undefined : 'transaction_reverted'
    };

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[executor-client] Execution failed:', errorMsg);
    
    return {
      success: false,
      reason: errorMsg
    };
  }
}
