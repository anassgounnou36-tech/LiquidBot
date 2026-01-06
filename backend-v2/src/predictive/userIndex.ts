// predictive/userIndex.ts: Token-aware user indexing for predictive re-scoring
// Maintains usersByToken index to efficiently trigger re-scoring when Pyth prices update

import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';

/**
 * UserIndex: Maintain token-aware user indexing for predictive re-scoring
 * When a price update arrives, we can quickly find all users holding that token
 */
export class UserIndex {
  // Map: symbol -> Set<userAddress>
  private usersByToken = new Map<string, Set<string>>();
  
  // Map: userAddress -> Set<symbol>
  private tokensByUser = new Map<string, Set<string>>();
  
  private riskSet: ActiveRiskSet;

  constructor(riskSet: ActiveRiskSet) {
    this.riskSet = riskSet;
  }

  /**
   * Register a user's token positions (collateral and debt)
   * @param user User address
   * @param collateralSymbols Array of collateral token symbols
   * @param debtSymbols Array of debt token symbols
   */
  register(user: string, collateralSymbols: string[], debtSymbols: string[]): void {
    const normalizedUser = user.toLowerCase();
    const allSymbols = [...collateralSymbols, ...debtSymbols];
    
    // Clear existing mappings for this user
    this.unregister(normalizedUser);
    
    // Build new mappings
    const userTokens = new Set<string>();
    for (const symbol of allSymbols) {
      const normalizedSymbol = symbol.toUpperCase();
      
      // Add to usersByToken
      if (!this.usersByToken.has(normalizedSymbol)) {
        this.usersByToken.set(normalizedSymbol, new Set());
      }
      this.usersByToken.get(normalizedSymbol)!.add(normalizedUser);
      
      // Track in tokensByUser
      userTokens.add(normalizedSymbol);
    }
    
    this.tokensByUser.set(normalizedUser, userTokens);
  }

  /**
   * Unregister a user (remove all token mappings)
   * @param user User address
   */
  unregister(user: string): void {
    const normalizedUser = user.toLowerCase();
    const userTokens = this.tokensByUser.get(normalizedUser);
    
    if (!userTokens) {
      return;
    }
    
    // Remove user from all token sets
    for (const symbol of userTokens) {
      const users = this.usersByToken.get(symbol);
      if (users) {
        users.delete(normalizedUser);
        // Clean up empty sets
        if (users.size === 0) {
          this.usersByToken.delete(symbol);
        }
      }
    }
    
    // Remove user's token set
    this.tokensByUser.delete(normalizedUser);
  }

  /**
   * Get all users holding a specific token
   * @param symbol Token symbol (e.g., "WETH", "USDC")
   * @returns Set of user addresses
   */
  getUsersByToken(symbol: string): Set<string> {
    const normalizedSymbol = symbol.toUpperCase();
    return this.usersByToken.get(normalizedSymbol) || new Set();
  }

  /**
   * Get all tokens held by a user
   * @param user User address
   * @returns Set of token symbols
   */
  getTokensByUser(user: string): Set<string> {
    const normalizedUser = user.toLowerCase();
    return this.tokensByUser.get(normalizedUser) || new Set();
  }

  /**
   * Get index statistics
   */
  getStats(): { uniqueTokens: number; totalUsers: number } {
    return {
      uniqueTokens: this.usersByToken.size,
      totalUsers: this.tokensByUser.size
    };
  }
}
