// risk/pairSelector.ts: Minimal pair selection for liquidation
// For PR2: uses env overrides (COLLATERAL_ASSET, DEBT_ASSET) as fallback

import { JsonRpcProvider } from 'ethers';

export interface SelectedPair {
  collateralAsset: string;
  debtAsset: string;
  payout: string;
}

/**
 * Select collateral/debt pair for liquidation
 * 
 * For PR2, this is a minimal implementation that:
 * 1. Requires COLLATERAL_ASSET and DEBT_ASSET env overrides
 * 2. Uses EXECUTOR_ADDRESS as payout recipient
 * 
 * Future: Query Aave UI Data Provider for per-user reserve info
 * 
 * @param opts Selection options
 * @returns Selected pair or null if cannot resolve
 */
export async function selectPair(opts: {
  http: JsonRpcProvider;
  user: string;
}): Promise<SelectedPair | null> {
  // Get payout address (executor receives profit)
  const payout = process.env.EXECUTOR_ADDRESS || '';
  if (!payout) {
    console.warn('[pair-selector] EXECUTOR_ADDRESS not set');
    return null;
  }

  // For PR2: require explicit env overrides
  const collateral = process.env.COLLATERAL_ASSET || '';
  const debt = process.env.DEBT_ASSET || '';

  if (!collateral || !debt) {
    console.warn(
      '[pair-selector] COLLATERAL_ASSET or DEBT_ASSET not set - ' +
      'set these env vars or implement per-user reserve query'
    );
    return null;
  }

  console.log('[pair-selector] Using env-configured pair:', {
    user: opts.user,
    collateral,
    debt,
    payout
  });

  return {
    collateralAsset: collateral,
    debtAsset: debt,
    payout
  };
}
