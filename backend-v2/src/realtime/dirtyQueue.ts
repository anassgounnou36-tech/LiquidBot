// dirtyQueue.ts: In-memory Set-based dirty queue for marking users that need HF verification

/**
 * DirtyQueue manages a set of users marked as "dirty" (needing HF verification)
 * Triggered by:
 * - Aave Pool events (Borrow, Repay, Supply, Withdraw)
 * - Chainlink price updates (NewTransmission)
 * - Pyth price updates
 */
export class DirtyQueue {
  private queue: Set<string> = new Set();
  private stats = {
    totalMarked: 0,
    totalProcessed: 0
  };

  /**
   * Mark a user as dirty (needs HF check)
   */
  markDirty(address: string): void {
    const normalized = address.toLowerCase();
    if (!this.queue.has(normalized)) {
      this.queue.add(normalized);
      this.stats.totalMarked++;
    }
  }

  /**
   * Take a batch of dirty users for processing
   * Returns up to `max` users and removes them from the queue
   */
  takeBatch(max: number): string[] {
    const batch: string[] = [];
    const iter = this.queue.values();
    
    for (let i = 0; i < max; i++) {
      const next = iter.next();
      if (next.done) break;
      batch.push(next.value);
      this.queue.delete(next.value);
    }
    
    this.stats.totalProcessed += batch.length;
    return batch;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      currentSize: this.queue.size,
      totalMarked: this.stats.totalMarked,
      totalProcessed: this.stats.totalProcessed
    };
  }

  /**
   * Clear the queue (for testing)
   */
  clear(): void {
    this.queue.clear();
  }
}
