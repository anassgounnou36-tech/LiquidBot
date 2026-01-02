// execution/attemptHistory.ts: Track per-user liquidation attempts

// Attempt status types
// Note: 'reverted' and 'included' are reserved for future transaction receipt parsing
export type AttemptStatus = 'sent' | 'reverted' | 'included' | 'error' | 'skip_no_pair';

export interface AttemptRecord {
  status: AttemptStatus;
  ts: number;
  txHash?: string;
  error?: string;
}

// In-memory map: user address -> array of attempts
const attemptMap = new Map<string, AttemptRecord[]>();

/**
 * Record a liquidation attempt for a user
 * 
 * @param record Attempt details
 */
export function recordAttempt(record: {
  user: string;
  status: AttemptStatus;
  txHash?: string;
  error?: string;
}): void {
  const normalizedUser = record.user.toLowerCase();
  const arr = attemptMap.get(normalizedUser) || [];
  
  arr.push({
    status: record.status,
    ts: Date.now(),
    txHash: record.txHash,
    error: record.error
  });
  
  attemptMap.set(normalizedUser, arr);
}

/**
 * Get all attempts for a user
 * 
 * @param user User address
 * @returns Array of attempt records
 */
export function getAttempts(user: string): AttemptRecord[] {
  return attemptMap.get(user.toLowerCase()) || [];
}

/**
 * Clear attempts for a user
 * 
 * @param user User address
 */
export function clearAttempts(user: string): void {
  attemptMap.delete(user.toLowerCase());
}

/**
 * Get total number of users with attempts
 */
export function getUserCount(): number {
  return attemptMap.size;
}
