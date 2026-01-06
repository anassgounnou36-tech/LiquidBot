// predictive/userIndex.ts: Token-aware user indexing for predictive re-scoring

/**
 * UserIndex: Maintain a mapping of token addresses to user addresses
 * Used for token-aware predictive re-scoring based on price movements
 */
export class UserIndex {
  // Map: token address (lowercase) -> Set of user addresses (lowercase)
  private usersByToken: Map<string, Set<string>> = new Map();
  
  // Map: user address (lowercase) -> Set of token addresses (lowercase)
  private tokensByUser: Map<string, Set<string>> = new Map();

  /**
   * Add a user-token relationship
   * @param user User address
   * @param token Token address (collateral or debt)
   */
  addUserToken(user: string, token: string): void {
    const normalizedUser = user.toLowerCase();
    const normalizedToken = token.toLowerCase();

    // Add to usersByToken index
    if (!this.usersByToken.has(normalizedToken)) {
      this.usersByToken.set(normalizedToken, new Set());
    }
    this.usersByToken.get(normalizedToken)!.add(normalizedUser);

    // Add to tokensByUser index (for removal)
    if (!this.tokensByUser.has(normalizedUser)) {
      this.tokensByUser.set(normalizedUser, new Set());
    }
    this.tokensByUser.get(normalizedUser)!.add(normalizedToken);
  }

  /**
   * Remove a user from all token indexes
   * @param user User address
   */
  removeUser(user: string): void {
    const normalizedUser = user.toLowerCase();
    const tokens = this.tokensByUser.get(normalizedUser);

    if (!tokens) return;

    // Remove user from all token indexes
    for (const token of tokens) {
      const users = this.usersByToken.get(token);
      if (users) {
        users.delete(normalizedUser);
        // Clean up empty token sets
        if (users.size === 0) {
          this.usersByToken.delete(token);
        }
      }
    }

    // Remove user from tokensByUser
    this.tokensByUser.delete(normalizedUser);
  }

  /**
   * Get all users affected by a token (collateral or debt)
   * @param token Token address
   * @returns Set of user addresses (lowercase)
   */
  getUsersForToken(token: string): Set<string> {
    const normalizedToken = token.toLowerCase();
    return this.usersByToken.get(normalizedToken) || new Set();
  }

  /**
   * Get all tracked tokens
   * @returns Array of token addresses (lowercase)
   */
  getTrackedTokens(): string[] {
    return Array.from(this.usersByToken.keys());
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): { tokenCount: number; userCount: number; totalRelationships: number } {
    let totalRelationships = 0;
    for (const users of this.usersByToken.values()) {
      totalRelationships += users.size;
    }

    return {
      tokenCount: this.usersByToken.size,
      userCount: this.tokensByUser.size,
      totalRelationships
    };
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.usersByToken.clear();
    this.tokensByUser.clear();
  }
}
