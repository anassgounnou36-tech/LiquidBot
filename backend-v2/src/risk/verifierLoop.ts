// risk/verifierLoop.ts: HF verification loop
// Pops dirty users from queue, rechecks HF, executes if liquidatable

import { Contract, JsonRpcProvider, BlockTag } from 'ethers';
import { DirtyQueue } from '../realtime/dirtyQueue.js';
import { selectPair } from './pairSelector.js';
import { getOneInchSwap } from '../execution/oneInch.js';
import { attemptLiquidation } from '../execution/executorClient.js';
import { recordAttempt } from '../execution/attemptHistory.js';

// Aave Pool ABI - getUserAccountData only
const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

export interface VerifierLoopOptions {
  http: JsonRpcProvider;
  aavePool: string;
  queue: DirtyQueue;
  minDebtUsd: number;
  hfExecute: number;
  batchCap?: number;
  blockTagMode?: 'pending' | 'latest';
}

/**
 * Start the HF verifier loop
 * 
 * Every 250ms (or event-driven):
 * 1. Pop batch of dirty users from queue
 * 2. Query getUserAccountData for each
 * 3. If HF <= HF_THRESHOLD_EXECUTE and debt >= MIN_DEBT_USD, attempt liquidation
 * 
 * @param opts Verifier loop configuration
 */
export function startVerifierLoop(opts: VerifierLoopOptions): void {
  const pool = new Contract(opts.aavePool, AAVE_POOL_ABI, opts.http);
  const cap = opts.batchCap ?? 200;
  const mode = opts.blockTagMode ?? 'latest';

  console.log('[verifier-loop] Starting with config:', {
    minDebtUsd: opts.minDebtUsd,
    hfExecute: opts.hfExecute,
    batchCap: cap,
    blockTagMode: mode
  });

  const tick = async () => {
    const batch = opts.queue.takeBatch(cap);
    
    if (batch.length === 0) {
      return; // No work
    }

    console.log(`[verifier-loop] Processing batch: ${batch.length} users`);

    for (const user of batch) {
      try {
        // Query user account data at specified block tag
        const tag: BlockTag = mode;
        const accountData = await pool.getUserAccountData(user, { blockTag: tag });
        
        const [
          /* totalCollateralBase */,
          totalDebtBase,
          /* availableBorrowsBase */,
          /* currentLiquidationThreshold */,
          /* ltv */,
          healthFactor
        ] = accountData;

        // Convert to decimal
        const hf = Number(healthFactor) / 1e18;
        const debtUsd = Number(totalDebtBase) / 1e8; // Aave uses 8 decimals for base units

        console.log(`[verifier-loop] User ${user}: HF=${hf.toFixed(4)} debtUsd=${debtUsd.toFixed(2)}`);

        // Check if liquidatable
        if (debtUsd >= opts.minDebtUsd && hf <= opts.hfExecute) {
          console.log(`[verifier-loop] Liquidatable: ${user} HF=${hf.toFixed(4)}`);

          // Select collateral/debt pair
          const pair = await selectPair({ http: opts.http, user });
          
          if (!pair) {
            console.warn(`[verifier-loop] No pair selected for ${user}`);
            recordAttempt({ user, status: 'skip_no_pair' });
            continue;
          }

          // Calculate debt to cover (fixed 50% for PR2)
          const debtToCover = totalDebtBase / 2n;

          // Get 1inch swap quote
          // We swap collateral -> debt asset to repay
          const quote = await getOneInchSwap({
            fromToken: pair.collateralAsset,
            toToken: pair.debtAsset,
            amount: debtToCover.toString(),
            slippageBps: 100, // 1% slippage
            fromAddress: pair.payout
          });

          // Attempt liquidation
          const result = await attemptLiquidation({
            user,
            collateralAsset: pair.collateralAsset,
            debtAsset: pair.debtAsset,
            debtToCover,
            oneInchCalldata: quote.data,
            minOut: BigInt(quote.minOut),
            payout: pair.payout
          });

          // Record attempt
          recordAttempt({
            user,
            status: result.success ? 'sent' : 'error',
            txHash: result.txHash,
            error: result.reason
          });

          if (result.success) {
            console.log(`[verifier-loop] Liquidation submitted: ${result.txHash}`);
          } else {
            console.error(`[verifier-loop] Liquidation failed: ${result.reason}`);
          }
        }

      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[verifier-loop] Error processing ${user}:`, errorMsg);
        
        recordAttempt({
          user,
          status: 'error',
          error: errorMsg
        });
      }
    }
  };

  // Run every 250ms
  setInterval(tick, 250);
  
  console.log('[verifier-loop] Started (tick interval: 250ms)');
}
