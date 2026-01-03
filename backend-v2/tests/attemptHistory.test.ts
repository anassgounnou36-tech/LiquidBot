import { describe, it, expect, beforeEach } from 'vitest';
import { AttemptHistory, type AttemptRecord } from '../src/execution/attemptHistory.js';

describe('AttemptHistory', () => {
  let history: AttemptHistory;

  beforeEach(() => {
    history = new AttemptHistory();
  });

  it('should record and retrieve attempts', () => {
    const record: AttemptRecord = {
      user: '0x1234567890123456789012345678901234567890',
      timestamp: Date.now(),
      status: 'included',
      txHash: '0xabc123',
      nonce: 1
    };

    history.record(record);
    const retrieved = history.getLastAttempt(record.user);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe('included');
    expect(retrieved?.txHash).toBe('0xabc123');
    expect(retrieved?.nonce).toBe(1);
  });

  it('should detect pending attempts', () => {
    const user = '0x1234567890123456789012345678901234567890';
    
    // No pending initially
    expect(history.hasPending(user)).toBe(false);
    expect(history.getPendingAttempt(user)).toBeNull();

    // Record pending attempt
    history.record({
      user,
      timestamp: Date.now(),
      status: 'pending',
      txHash: '0xpending123',
      nonce: 5
    });

    // Should detect pending
    expect(history.hasPending(user)).toBe(true);
    
    const pending = history.getPendingAttempt(user);
    expect(pending).not.toBeNull();
    expect(pending?.status).toBe('pending');
    expect(pending?.txHash).toBe('0xpending123');
    expect(pending?.nonce).toBe(5);
  });

  it('should clear pending after new attempt', () => {
    const user = '0x1234567890123456789012345678901234567890';
    
    // Record pending
    history.record({
      user,
      timestamp: Date.now(),
      status: 'pending',
      txHash: '0xpending123',
      nonce: 5
    });

    expect(history.hasPending(user)).toBe(true);

    // Record successful inclusion
    history.record({
      user,
      timestamp: Date.now(),
      status: 'included',
      txHash: '0xmined123',
      nonce: 5
    });

    // Should no longer be pending
    expect(history.hasPending(user)).toBe(false);
    expect(history.getPendingAttempt(user)).toBeNull();
  });

  it('should track all attempt statuses', () => {
    const user = '0x1234567890123456789012345678901234567890';
    
    const statuses: Array<AttemptRecord['status']> = [
      'sent',
      'pending',
      'included',
      'reverted',
      'failed',
      'error',
      'skip_no_pair'
    ];

    for (const status of statuses) {
      history.record({
        user,
        timestamp: Date.now(),
        status
      });
    }

    const userHistory = history.getHistory(user);
    expect(userHistory.length).toBe(statuses.length);
    
    // Last attempt should be skip_no_pair
    const last = history.getLastAttempt(user);
    expect(last?.status).toBe('skip_no_pair');
  });

  it('should maintain stats correctly', () => {
    const user1 = '0x1111111111111111111111111111111111111111';
    const user2 = '0x2222222222222222222222222222222222222222';

    history.record({ user: user1, timestamp: Date.now(), status: 'included' });
    history.record({ user: user1, timestamp: Date.now(), status: 'pending' });
    history.record({ user: user2, timestamp: Date.now(), status: 'failed' });
    history.record({ user: user2, timestamp: Date.now(), status: 'reverted' });

    const stats = history.getStats();
    
    expect(stats.totalUsers).toBe(2);
    expect(stats.totalAttempts).toBe(4);
    expect(stats.statusCounts.included).toBe(1);
    expect(stats.statusCounts.pending).toBe(1);
    expect(stats.statusCounts.failed).toBe(1);
    expect(stats.statusCounts.reverted).toBe(1);
  });

  it('should normalize user addresses to lowercase', () => {
    const userMixed = '0xAbCdEf1234567890123456789012345678901234';
    const userLower = userMixed.toLowerCase();

    history.record({
      user: userMixed,
      timestamp: Date.now(),
      status: 'included'
    });

    // Should retrieve by lowercase
    const attempt1 = history.getLastAttempt(userLower);
    expect(attempt1).not.toBeNull();

    // Should also retrieve by mixed case
    const attempt2 = history.getLastAttempt(userMixed);
    expect(attempt2).not.toBeNull();

    // Should be same attempt
    expect(attempt1).toEqual(attempt2);
  });

  it('should limit history entries per user', () => {
    const user = '0x1234567890123456789012345678901234567890';
    
    // Record 15 attempts (max is 10)
    for (let i = 0; i < 15; i++) {
      history.record({
        user,
        timestamp: Date.now() + i,
        status: 'included',
        nonce: i
      });
    }

    const userHistory = history.getHistory(user);
    
    // Should only keep last 10
    expect(userHistory.length).toBe(10);
    
    // First entry should be nonce 5 (oldest ones removed)
    expect(userHistory[0].nonce).toBe(5);
    
    // Last entry should be nonce 14
    expect(userHistory[9].nonce).toBe(14);
  });
});
