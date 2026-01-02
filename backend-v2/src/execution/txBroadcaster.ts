// execution/txBroadcaster.ts: Multi-RPC broadcast with transaction replacement

import { ethers } from 'ethers';

/**
 * Broadcast result
 */
export interface BroadcastResult {
  success: boolean;
  txHash?: string;
  error?: string;
  rpcUsed?: string;
}

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

  constructor(options: BroadcastOptions) {
    this.options = {
      rpcUrls: options.rpcUrls,
      replacementDelayMs: options.replacementDelayMs || 3000,
      maxReplacements: options.maxReplacements || 3,
      priorityFeeBumpPercent: options.priorityFeeBumpPercent || 20
    };
  }

  /**
   * Broadcast signed raw transaction to all RPCs
   */
  private async broadcastToAllRpcs(signedTx: string): Promise<string | null> {
    const promises = this.options.rpcUrls.map(async (rpcUrl) => {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const tx = await provider.broadcastTransaction(signedTx);
        console.log(`[txBroadcaster] Broadcast to ${rpcUrl}: ${tx.hash}`);
        return tx.hash;
      } catch (err) {
        console.warn(`[txBroadcaster] Failed to broadcast to ${rpcUrl}:`, err instanceof Error ? err.message : err);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successfulHash = results.find(hash => hash !== null);
    
    return successfulHash || null;
  }

  /**
   * Check if transaction is mined
   */
  private async isTxMined(txHash: string, provider: ethers.JsonRpcProvider): Promise<boolean> {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      return receipt !== null;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast transaction with replacement strategy
   * 
   * @param wallet Wallet to sign transactions
   * @param txRequest Transaction request
   * @returns Broadcast result
   */
  async broadcastWithReplacement(
    wallet: ethers.Wallet,
    txRequest: ethers.TransactionRequest
  ): Promise<BroadcastResult> {
    try {
      // Use first RPC for monitoring
      const monitorProvider = new ethers.JsonRpcProvider(this.options.rpcUrls[0]);
      
      // Initial transaction
      let currentPriorityFee = txRequest.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');
      let currentMaxFee = txRequest.maxFeePerGas || ethers.parseUnits('50', 'gwei');
      let currentNonce = txRequest.nonce;
      
      // If nonce not provided, get it
      if (currentNonce === undefined || currentNonce === null) {
        currentNonce = await wallet.getNonce();
      }

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
          if (attempt === this.options.maxReplacements) {
            return {
              success: false,
              error: 'Failed to broadcast to any RPC'
            };
          }
          continue;
        }

        // Wait for inclusion or delay
        const startTime = Date.now();
        while (Date.now() - startTime < this.options.replacementDelayMs) {
          const mined = await this.isTxMined(txHash, monitorProvider);
          
          if (mined) {
            console.log(`[txBroadcaster] Transaction mined: ${txHash}`);
            return {
              success: true,
              txHash,
              rpcUsed: this.options.rpcUrls[0]
            };
          }

          // Wait 500ms before checking again
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`[txBroadcaster] Transaction not mined after ${this.options.replacementDelayMs}ms`);

        // If this was the last attempt, return the hash anyway
        if (attempt === this.options.maxReplacements) {
          console.log(`[txBroadcaster] Max replacements reached, returning last tx: ${txHash}`);
          return {
            success: true,
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

      return {
        success: false,
        error: 'Failed after all replacement attempts'
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[txBroadcaster] Broadcast failed:', errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }
  }
}
