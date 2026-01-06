// execution/txBroadcaster.ts: Multi-RPC broadcast with transaction replacement

import { ethers, TransactionReceipt } from 'ethers';
import { config } from '../config/index.js';

/**
 * Broadcast result with status discrimination
 */
export type BroadcastResult =
  | { status: 'mined'; txHash: string; receipt: TransactionReceipt; rpcUsed: string }
  | { status: 'pending'; txHash: string; rpcUsed: string }
  | { status: 'failed'; error: string; lastTxHash?: string };

/**
 * Broadcast options
 */
export interface BroadcastOptions {
  rpcUrls: string[];
  replacementDelayMs?: number; // Wait time before replacement (default: 3000ms)
  maxReplacements?: number; // Max number of replacements (default: 3)
  priorityFeeBumpPercent?: number; // Priority fee bump percent (default: 20%)
}

/**
 * TxBroadcaster: Multi-RPC transaction broadcaster with replacement strategy
 * 
 * Strategy:
 * 1. Sign transaction once
 * 2. Broadcast raw tx to all configured RPCs simultaneously
 * 3. If not included within delay, replace with higher priority fee
 * 4. Repeat up to maxReplacements times
 */
export class TxBroadcaster {
  private options: Required<BroadcastOptions>;
  private providers: ethers.JsonRpcProvider[];
  private monitorProvider: ethers.JsonRpcProvider;

  constructor(options: BroadcastOptions) {
    this.options = {
      rpcUrls: options.rpcUrls,
      replacementDelayMs: options.replacementDelayMs || config.REPLACE_AFTER_MS,
      maxReplacements: options.maxReplacements || config.REPLACE_MAX_ATTEMPTS,
      priorityFeeBumpPercent: options.priorityFeeBumpPercent || config.FEE_BUMP_PCT
    };

    // Create providers once during initialization to avoid per-tx overhead
    this.providers = this.options.rpcUrls.map(url => new ethers.JsonRpcProvider(url));
    this.monitorProvider = this.providers[0];
    
    console.log(
      `[txBroadcaster] Initialized with ${this.providers.length} RPC providers ` +
      `(delay=${this.options.replacementDelayMs}ms, maxAttempts=${this.options.maxReplacements}, bump=${this.options.priorityFeeBumpPercent}%)`
    );
  }

  /**
   * Broadcast signed raw transaction to all RPCs using reusable providers
   */
  private async broadcastToAllRpcs(signedTx: string): Promise<string | null> {
    const promises = this.providers.map(async (provider, index) => {
      try {
        const tx = await provider.broadcastTransaction(signedTx);
        console.log(`[txBroadcaster] Broadcast to RPC ${index + 1}: ${tx.hash}`);
        return tx.hash;
      } catch (err) {
        console.warn(`[txBroadcaster] Failed to broadcast to RPC ${index + 1}:`, err instanceof Error ? err.message : err);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successfulHash = results.find(hash => hash !== null);
    
    return successfulHash || null;
  }

  /**
   * Check if transaction is mined and return receipt
   */
  private async getTxReceipt(txHash: string, provider: ethers.JsonRpcProvider): Promise<TransactionReceipt | null> {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      return receipt;
    } catch {
      return null;
    }
  }

  /**
   * Broadcast transaction with replacement strategy
   * 
   * @param wallet Wallet to sign transactions
   * @param txRequest Transaction request
   * @returns Broadcast result with status discrimination
   */
  async broadcastWithReplacement(
    wallet: ethers.Wallet,
    txRequest: ethers.TransactionRequest
  ): Promise<BroadcastResult> {
    try {
      // Initial transaction
      let currentPriorityFee = txRequest.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');
      let currentMaxFee = txRequest.maxFeePerGas || ethers.parseUnits('50', 'gwei');
      let currentNonce = txRequest.nonce;
      
      // Always get nonce from "pending" to avoid collisions
      if (currentNonce === undefined || currentNonce === null) {
        currentNonce = await wallet.getNonce('pending');
        console.log(`[txBroadcaster] Using pending nonce: ${currentNonce}`);
      }

      let lastTxHash: string | null = null;
      let broadcastSucceededOnce = false;

      for (let attempt = 0; attempt <= this.options.maxReplacements; attempt++) {
        // Sign transaction
        const tx = await wallet.signTransaction({
          ...txRequest,
          nonce: currentNonce,
          maxPriorityFeePerGas: currentPriorityFee,
          maxFeePerGas: currentMaxFee
        });

        console.log(`[txBroadcaster] Attempt ${attempt + 1}/${this.options.maxReplacements + 1}`);
        console.log(`[txBroadcaster] Priority fee: ${ethers.formatUnits(currentPriorityFee, 'gwei')} gwei`);

        // Broadcast to all RPCs
        const txHash = await this.broadcastToAllRpcs(tx);
        
        if (!txHash) {
          console.error('[txBroadcaster] Failed to broadcast to any RPC');
          // If this was the last attempt and we never successfully broadcast
          if (attempt === this.options.maxReplacements) {
            // If we had a previous successful broadcast, it may still be pending
            if (broadcastSucceededOnce && lastTxHash) {
              return {
                status: 'pending',
                txHash: lastTxHash,
                rpcUsed: this.options.rpcUrls[0]
              };
            }
            // Otherwise, it's a complete failure
            return {
              status: 'failed',
              error: 'Failed to broadcast to any RPC',
              lastTxHash: lastTxHash || undefined
            };
          }
          continue;
        }

        lastTxHash = txHash;
        broadcastSucceededOnce = true;

        // Wait for inclusion or delay
        const startTime = Date.now();
        while (Date.now() - startTime < this.options.replacementDelayMs) {
          const receipt = await this.getTxReceipt(txHash, this.monitorProvider);
          
          if (receipt !== null) {
            // Check if transaction succeeded
            if (receipt.status === 1) {
              console.log(`[txBroadcaster] Transaction mined successfully: ${txHash}`);
              return {
                status: 'mined',
                txHash,
                receipt,
                rpcUsed: this.options.rpcUrls[0]
              };
            } else {
              console.error(`[txBroadcaster] Transaction reverted: ${txHash}`);
              return {
                status: 'failed',
                error: 'Transaction reverted',
                lastTxHash: txHash
              };
            }
          }

          // Wait 500ms before checking again
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`[txBroadcaster] Transaction not mined after ${this.options.replacementDelayMs}ms`);

        // If this was the last attempt, return pending status (tx may still land)
        if (attempt === this.options.maxReplacements) {
          console.log(`[txBroadcaster] Max replacements reached, tx still pending: ${txHash}`);
          return {
            status: 'pending',
            txHash,
            rpcUsed: this.options.rpcUrls[0]
          };
        }

        // Bump priority fee for next attempt
        const bumpFactor = BigInt(100 + this.options.priorityFeeBumpPercent);
        currentPriorityFee = (BigInt(currentPriorityFee.toString()) * bumpFactor) / 100n;
        currentMaxFee = (BigInt(currentMaxFee.toString()) * bumpFactor) / 100n;

        console.log(`[txBroadcaster] Bumping fees and replacing...`);
      }

      // This should never be reached due to the logic above, but included for completeness
      // If we have a txHash, it's pending; otherwise it's failed
      if (lastTxHash) {
        return {
          status: 'pending',
          txHash: lastTxHash,
          rpcUsed: this.options.rpcUrls[0]
        };
      } else {
        return {
          status: 'failed',
          error: 'Failed after all replacement attempts',
          lastTxHash: undefined
        };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[txBroadcaster] Broadcast failed:', errorMsg);
      return {
        status: 'failed',
        error: errorMsg
      };
    }
  }
}
