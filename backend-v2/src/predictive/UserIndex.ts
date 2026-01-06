// predictive/UserIndex.ts: Token-to-users index for predictive liquidation
// Maps token addresses (lowercase canonical) to Set<userAddress>

/**
 * UserIndex: Maintain token address → Set<userAddress> mapping
 * 
 * Purpose: Enable efficient lookup of users affected by a token price change.
 * When a Pyth price update occurs for a token, we can quickly find all users
 * who have exposure to that token (either as collateral or debt).
 * 
 * Key principles:
 * - Token addresses are stored in LOWERCASE (canonical form)
 * - Symbols are only used for logging
 * - Anchor tokens (e.g., weETH → ETH) are also indexed
 * - Users are tracked by lowercase address
 */
export class UserIndex {
  // tokenKey (lowercase address) -> Set<userAddress (lowercase)>
  private tokenToUsers: Map<string, Set<string>> = new Map();
  
  // userAddress (lowercase) -> Set<token address (lowercase)>
  private userToTokens: Map<string, Set<string>> = new Map();

  /**
   * Set the tokens associated with a user (replaces previous tokens)
   * 
   * This method replaces any previous token associations for the user,
   * ensuring the index accurately reflects current user exposure.
   * 
   * @param userAddress User address (will be normalized to lowercase)
   * @param tokenAddresses Array of token addresses that the user has exposure to
   *                       (includes both collateral and debt tokens, plus anchors)
   */
  setUserTokens(userAddress: string, tokenAddresses: string[]): void {
    const normalizedUser = userAddress.toLowerCase();
    
    // Remove user from previous token associations
    const previousTokens = this.userToTokens.get(normalizedUser);
    if (previousTokens) {
      for (const token of previousTokens) {
        const users = this.tokenToUsers.get(token);
        if (users) {
          users.delete(normalizedUser);
          // Clean up empty token sets
          if (users.size === 0) {
            this.tokenToUsers.delete(token);
          }
        }
      }
    }
    
    // Normalize token addresses to lowercase
    const normalizedTokens = tokenAddresses.map(t => t.toLowerCase());
    const tokenSet = new Set(normalizedTokens);
    
    // Update user -> tokens mapping
    this.userToTokens.set(normalizedUser, tokenSet);
    
    // Add user to each token's set
    for (const tokenAddress of normalizedTokens) {
      if (!this.tokenToUsers.has(tokenAddress)) {
        this.tokenToUsers.set(tokenAddress, new Set());
      }
      this.tokenToUsers.get(tokenAddress)!.add(normalizedUser);
    }
  }

  /**
   * Get all users who have exposure to a specific token
   * 
   * @param tokenAddress Token address (will be normalized to lowercase)
   * @returns Set of user addresses, or empty Set if token not found
   */
  getUsersForToken(tokenAddress: string): Set<string> {
    const normalizedToken = tokenAddress.toLowerCase();
    return this.tokenToUsers.get(normalizedToken) || new Set();
  }

  /**
   * Remove a user from the index
   */
  removeUser(userAddress: string): void {
    const normalizedUser = userAddress.toLowerCase();
    
    // Remove from all token associations
    const tokens = this.userToTokens.get(normalizedUser);
    if (tokens) {
      for (const token of tokens) {
        const users = this.tokenToUsers.get(token);
        if (users) {
          users.delete(normalizedUser);
          // Clean up empty token sets
          if (users.size === 0) {
            this.tokenToUsers.delete(token);
          }
        }
      }
    }
    
    // Remove user mapping
    this.userToTokens.delete(normalizedUser);
  }

  /**
   * Get statistics about the index for logging
   */
  getStats(): { tokenCount: number; userCount: number; avgTokensPerUser: number } {
    const userCount = this.userToTokens.size;
    let totalTokens = 0;
    for (const tokens of this.userToTokens.values()) {
      totalTokens += tokens.size;
    }
    const avgTokensPerUser = userCount > 0 ? totalTokens / userCount : 0;
    
    return {
      tokenCount: this.tokenToUsers.size,
      userCount,
      avgTokensPerUser: Number(avgTokensPerUser.toFixed(2))
    };
  }

  /**
   * Clear the index (useful for rebuilding)
   */
  clear(): void {
    this.tokenToUsers.clear();
    this.userToTokens.clear();
  }

  /**
   * Get all indexed tokens
   */
  getIndexedTokens(): string[] {
    return Array.from(this.tokenToUsers.keys());
  }
}
