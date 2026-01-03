// attemptHistory.ts: Per-user attempt history log

/**
 * Attempt status
 */
export type AttemptStatus = 'sent' | 'reverted' | 'included' | 'error' | 'skip_no_pair' | 'pending' | 'failed';

/**
 * Attempt record
 */
export interface AttemptRecord {
  user: string;
  timestamp: number;
  status: AttemptStatus;
  txHash?: string;
  nonce?: number;
  error?: string;
  debtAsset?: string;
  collateralAsset?: string;
  debtToCover?: string;
}

/**
 * AttemptHistory tracks liquidation attempts per user
 */
export class AttemptHistory {
  private history: Map<string, AttemptRecord[]> = new Map();
  private maxEntriesPerUser = 10;

  /**
   * Record an attempt
   */
  record(record: AttemptRecord): void {
    const normalized = record.user.toLowerCase();
    const userHistory = this.history.get(normalized) || [];
    
    userHistory.push(record);
    
    // Keep only last N entries
    if (userHistory.length > this.maxEntriesPerUser) {
      userHistory.shift();
    }
    
    this.history.set(normalized, userHistory);
  }

  /**
   * Get attempt history for a user
   */
  getHistory(user: string): AttemptRecord[] {
    const normalized = user.toLowerCase();
    return this.history.get(normalized) || [];
  }

  /**
   * Get last attempt for a user
   */
  getLastAttempt(user: string): AttemptRecord | null {
    const userHistory = this.getHistory(user);
    return userHistory.length > 0 ? userHistory[userHistory.length - 1] : null;
  }

  /**
   * Clear history for a user
   */
  clear(user: string): void {
    const normalized = user.toLowerCase();
    this.history.delete(normalized);
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalAttempts = 0;
    const statusCounts: Record<AttemptStatus, number> = {
      sent: 0,
      reverted: 0,
      included: 0,
      error: 0,
      skip_no_pair: 0,
      pending: 0,
      failed: 0
    };

    for (const userHistory of this.history.values()) {
      totalAttempts += userHistory.length;
      for (const record of userHistory) {
        statusCounts[record.status]++;
      }
    }

    return {
      totalUsers: this.history.size,
      totalAttempts,
      statusCounts
    };
  }

  /**
   * Check if user has a pending attempt
   * Returns true if last attempt status is 'pending'
   */
  hasPending(user: string): boolean {
    const lastAttempt = this.getLastAttempt(user);
    return lastAttempt !== null && lastAttempt.status === 'pending';
  }

  /**
   * Get pending attempt for a user
   * Returns the last attempt if it's pending, null otherwise
   */
  getPendingAttempt(user: string): AttemptRecord | null {
    const lastAttempt = this.getLastAttempt(user);
    return lastAttempt !== null && lastAttempt.status === 'pending' ? lastAttempt : null;
  }
}
