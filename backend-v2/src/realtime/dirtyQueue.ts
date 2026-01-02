// realtime/dirtyQueue.ts: Simple in-memory dirty user queue

/**
 * DirtyQueue: Track users that need HF rechecking
 * 
 * Simple in-memory set-based queue for marking users "dirty" when
 * price updates or Aave events occur. The verifier loop pops batches
 * and rechecks health factors.
 */
export class DirtyQueue {
  private set = new Set<string>();

  /**
   * Mark a user as dirty (needs HF recheck)
   */
  markDirty(addr: string): void {
    this.set.add(addr.toLowerCase());
  }

  /**
   * Take a batch of dirty users and remove them from the queue
   * @param max Maximum number of users to return
   * @returns Array of user addresses
   */
  takeBatch(max: number): string[] {
    const arr = Array.from(this.set).slice(0, max);
    arr.forEach(a => this.set.delete(a));
    return arr;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.set.size;
  }

  /**
   * Clear all dirty users
   */
  clear(): void {
    this.set.clear();
  }
}
