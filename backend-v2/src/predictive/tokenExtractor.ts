// predictive/tokenExtractor.ts: Extract token exposure from user reserves

import type { UserReserveData } from '../aave/protocolDataProvider.js';

// LST tokens that use ETH/WETH as pricing anchor
const LST_TOKENS_TO_ETH_ANCHOR: Record<string, boolean> = {
  '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': true, // weETH
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': true, // wstETH  
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': true, // cbETH
};

// WETH address on Base
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

/**
 * Extract token addresses where user has exposure (collateral or debt)
 * Includes anchor tokens for LSTs
 */
export function extractUserTokens(reserves: UserReserveData[]): string[] {
  const tokens = new Set<string>();
  
  for (const reserve of reserves) {
    const hasCollateral = reserve.currentATokenBalance > 0n;
    const hasDebt = reserve.currentStableDebt > 0n || reserve.currentVariableDebt > 0n;
    
    if (hasCollateral || hasDebt) {
      // Add the token itself (lowercase)
      const tokenAddress = reserve.underlyingAsset.toLowerCase();
      tokens.add(tokenAddress);
      
      // If token is an LST, also add WETH anchor
      if (LST_TOKENS_TO_ETH_ANCHOR[tokenAddress]) {
        tokens.add(WETH_ADDRESS.toLowerCase());
      }
    }
  }
  
  return Array.from(tokens);
}

/**
 * Check if user has any exposure (for logging)
 */
export function hasAnyExposure(reserves: UserReserveData[]): boolean {
  return reserves.some(r => 
    r.currentATokenBalance > 0n || 
    r.currentStableDebt > 0n || 
    r.currentVariableDebt > 0n
  );
}
