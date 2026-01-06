import { describe, it, expect, beforeEach } from 'vitest';
import { UserIndex } from '../src/predictive/UserIndex.js';

describe('UserIndex', () => {
  let userIndex: UserIndex;

  beforeEach(() => {
    userIndex = new UserIndex();
  });

  it('should initialize with empty stats', () => {
    const stats = userIndex.getStats();
    expect(stats.tokenCount).toBe(0);
    expect(stats.userCount).toBe(0);
    expect(stats.avgTokensPerUser).toBe(0);
  });

  it('should set user tokens and track users', () => {
    const user1 = '0xUser1';
    const token1 = '0xToken1';
    const token2 = '0xToken2';

    userIndex.setUserTokens(user1, [token1, token2]);

    const stats = userIndex.getStats();
    expect(stats.tokenCount).toBe(2);
    expect(stats.userCount).toBe(1);
    expect(stats.avgTokensPerUser).toBe(2);
  });

  it('should normalize addresses to lowercase', () => {
    const user1 = '0xUSER1';
    const token1 = '0xTOKEN1';

    userIndex.setUserTokens(user1, [token1]);

    // Query with different case should work
    const users = userIndex.getUsersForToken('0xtoken1');
    expect(users.size).toBe(1);
    expect(users.has('0xuser1')).toBe(true);
  });

  it('should track multiple users for the same token', () => {
    const user1 = '0xUser1';
    const user2 = '0xUser2';
    const token1 = '0xToken1';

    userIndex.setUserTokens(user1, [token1]);
    userIndex.setUserTokens(user2, [token1]);

    const users = userIndex.getUsersForToken(token1);
    expect(users.size).toBe(2);
    expect(users.has(user1.toLowerCase())).toBe(true);
    expect(users.has(user2.toLowerCase())).toBe(true);
  });

  it('should return empty set for unknown token', () => {
    const users = userIndex.getUsersForToken('0xUnknownToken');
    expect(users.size).toBe(0);
  });

  it('should handle user with multiple tokens', () => {
    const user1 = '0xUser1';
    const token1 = '0xToken1';
    const token2 = '0xToken2';
    const token3 = '0xToken3';

    userIndex.setUserTokens(user1, [token1, token2, token3]);

    const stats = userIndex.getStats();
    expect(stats.tokenCount).toBe(3);
    expect(stats.userCount).toBe(1);
    expect(stats.avgTokensPerUser).toBe(3);

    // User should be in all token sets
    expect(userIndex.getUsersForToken(token1).has(user1.toLowerCase())).toBe(true);
    expect(userIndex.getUsersForToken(token2).has(user1.toLowerCase())).toBe(true);
    expect(userIndex.getUsersForToken(token3).has(user1.toLowerCase())).toBe(true);
  });

  it('should clear the index', () => {
    const user1 = '0xUser1';
    const token1 = '0xToken1';

    userIndex.setUserTokens(user1, [token1]);
    expect(userIndex.getStats().tokenCount).toBe(1);

    userIndex.clear();

    const stats = userIndex.getStats();
    expect(stats.tokenCount).toBe(0);
    expect(stats.userCount).toBe(0);
  });

  it('should get all indexed tokens', () => {
    const user1 = '0xUser1';
    const token1 = '0xToken1';
    const token2 = '0xToken2';

    userIndex.setUserTokens(user1, [token1, token2]);

    const tokens = userIndex.getIndexedTokens();
    expect(tokens.length).toBe(2);
    expect(tokens).toContain(token1.toLowerCase());
    expect(tokens).toContain(token2.toLowerCase());
  });

  it('should replace user tokens when called multiple times for same user', () => {
    const user1 = '0xUser1';
    const token1 = '0xToken1';
    const token2 = '0xToken2';

    // First call
    userIndex.setUserTokens(user1, [token1]);
    expect(userIndex.getUsersForToken(token1).size).toBe(1);
    expect(userIndex.getUsersForToken(token2).size).toBe(0);

    // Second call - replaces previous tokens
    userIndex.setUserTokens(user1, [token2]);
    expect(userIndex.getUsersForToken(token1).size).toBe(0); // User removed from token1
    expect(userIndex.getUsersForToken(token2).size).toBe(1); // User added to token2

    // User count should remain 1
    expect(userIndex.getStats().userCount).toBe(1);
  });
  
  it('should remove user from index', () => {
    const user1 = '0xUser1';
    const token1 = '0xToken1';
    const token2 = '0xToken2';

    userIndex.setUserTokens(user1, [token1, token2]);
    expect(userIndex.getStats().userCount).toBe(1);

    userIndex.removeUser(user1);

    expect(userIndex.getStats().userCount).toBe(0);
    expect(userIndex.getUsersForToken(token1).size).toBe(0);
    expect(userIndex.getUsersForToken(token2).size).toBe(0);
  });
});
