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
  
  // Track statistics for logging
  private totalUsers: Set<string> = new Set();

  /**
   * Update the tokens associated with a user
   * 
   * NOTE: Current implementation is additive - tokens are added but not removed.
   * This is intentional for the minimal implementation where all users are indexed
   * with the same fixed set of common tokens. When per-user token extraction is
   * implemented, this method should be enhanced to replace existing associations
   * rather than accumulate them.
   * 
   * @param userAddress User address (will be normalized to lowercase)
   * @param tokenAddresses Array of token addresses that the user has exposure to
   *                       (includes both collateral and debt tokens, plus anchors)
   */
  updateUserTokens(userAddress: string, tokenAddresses: string[]): void {
    const normalizedUser = userAddress.toLowerCase();
    this.totalUsers.add(normalizedUser);

    // Normalize token addresses to lowercase
    const normalizedTokens = tokenAddresses.map(t => t.toLowerCase());

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
   * Get statistics about the index for logging
   */
  getStats(): { tokenCount: number; userCount: number } {
    return {
      tokenCount: this.tokenToUsers.size,
      userCount: this.totalUsers.size
    };
  }

  /**
   * Clear the index (useful for rebuilding)
   */
  clear(): void {
    this.tokenToUsers.clear();
    this.totalUsers.clear();
  }

  /**
   * Get all indexed tokens
   */
  getIndexedTokens(): string[] {
    return Array.from(this.tokenToUsers.keys());
  }
}
