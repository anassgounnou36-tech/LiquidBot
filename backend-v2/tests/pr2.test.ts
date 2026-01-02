import { describe, it, expect, beforeEach } from 'vitest';
import { DirtyQueue } from '../src/realtime/dirtyQueue.js';
import { recordAttempt, getAttempts, clearAttempts } from '../src/execution/attemptHistory.js';

describe('DirtyQueue', () => {
  let queue: DirtyQueue;

  beforeEach(() => {
    queue = new DirtyQueue();
  });

  it('should mark users as dirty', () => {
    queue.markDirty('0xUser1');
    queue.markDirty('0xUser2');
    
    expect(queue.size()).toBe(2);
  });

  it('should normalize addresses to lowercase', () => {
    queue.markDirty('0xUSER1');
    queue.markDirty('0xuser1');
    
    // Should only have one user (normalized)
    expect(queue.size()).toBe(1);
  });

  it('should take a batch of dirty users', () => {
    queue.markDirty('0xUser1');
    queue.markDirty('0xUser2');
    queue.markDirty('0xUser3');
    
    const batch = queue.takeBatch(2);
    
    expect(batch.length).toBe(2);
    expect(queue.size()).toBe(1); // One left in queue
  });

  it('should return empty array when queue is empty', () => {
    const batch = queue.takeBatch(10);
    
    expect(batch).toEqual([]);
    expect(queue.size()).toBe(0);
  });

  it('should clear all dirty users', () => {
    queue.markDirty('0xUser1');
    queue.markDirty('0xUser2');
    
    queue.clear();
    
    expect(queue.size()).toBe(0);
  });
});

describe('AttemptHistory', () => {
  beforeEach(() => {
    // Clear all attempts before each test
    clearAttempts('0xUser1');
    clearAttempts('0xUser2');
  });

  it('should record an attempt for a user', () => {
    recordAttempt({
      user: '0xUser1',
      status: 'sent',
      txHash: '0xabcd'
    });
    
    const attempts = getAttempts('0xUser1');
    
    expect(attempts.length).toBe(1);
    expect(attempts[0].status).toBe('sent');
    expect(attempts[0].txHash).toBe('0xabcd');
  });

  it('should normalize user addresses to lowercase', () => {
    recordAttempt({
      user: '0xUSER1',
      status: 'sent'
    });
    
    const attempts = getAttempts('0xuser1');
    
    expect(attempts.length).toBe(1);
  });

  it('should record multiple attempts for the same user', () => {
    recordAttempt({
      user: '0xUser1',
      status: 'sent',
      txHash: '0xaaa'
    });
    
    recordAttempt({
      user: '0xUser1',
      status: 'error',
      error: 'test error'
    });
    
    const attempts = getAttempts('0xUser1');
    
    expect(attempts.length).toBe(2);
    expect(attempts[0].status).toBe('sent');
    expect(attempts[1].status).toBe('error');
  });

  it('should return empty array for users with no attempts', () => {
    const attempts = getAttempts('0xUser99');
    
    expect(attempts).toEqual([]);
  });

  it('should clear attempts for a user', () => {
    recordAttempt({
      user: '0xUser1',
      status: 'sent'
    });
    
    clearAttempts('0xUser1');
    
    const attempts = getAttempts('0xUser1');
    expect(attempts).toEqual([]);
  });

  it('should track timestamps on attempts', () => {
    const beforeTs = Date.now();
    
    recordAttempt({
      user: '0xUser1',
      status: 'sent'
    });
    
    const afterTs = Date.now();
    const attempts = getAttempts('0xUser1');
    
    expect(attempts.length).toBe(1);
    expect(attempts[0].ts).toBeGreaterThanOrEqual(beforeTs);
    expect(attempts[0].ts).toBeLessThanOrEqual(afterTs);
  });
});
