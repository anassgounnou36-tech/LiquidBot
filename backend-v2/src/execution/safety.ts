// safety.ts: Shared repayment safety formulas
// Used by both liquidationPlanner (for candidate scoring) and executorClient (for safety checks)

/**
 * Flashloan fee in basis points (0.09%)
 */
export const FLASHLOAN_FEE_BPS = 9;

/**
 * Safety buffer in basis points (0.5%)
 */
export const SAFETY_BUFFER_BPS = 50;

/**
 * Compute minimum required output from swap to cover debt repayment
 * Formula: minRequiredOut = debtToCover + flashloanFee + safetyBuffer
 * 
 * @param debtToCover Debt amount to cover in debt token units
 * @param flashloanFeeBps Flashloan fee in basis points (default: FLASHLOAN_FEE_BPS)
 * @param safetyBufferBps Safety buffer in basis points (default: SAFETY_BUFFER_BPS)
 * @returns Minimum required output in debt token units
 */
export function computeMinRequiredOut(
  debtToCover: bigint,
  flashloanFeeBps: number = FLASHLOAN_FEE_BPS,
  safetyBufferBps: number = SAFETY_BUFFER_BPS
): bigint {
  const flashloanFee = (debtToCover * BigInt(flashloanFeeBps)) / 10000n;
  const safetyBuffer = (debtToCover * BigInt(safetyBufferBps)) / 10000n;
  return debtToCover + flashloanFee + safetyBuffer;
}

/**
 * Compute net debt token profit from a swap
 * Formula: netDebtToken = minOut - debtToCover - flashloanFee - safetyBuffer
 * 
 * @param minOut Minimum output from swap in debt token units
 * @param debtToCover Debt amount to cover in debt token units
 * @param flashloanFeeBps Flashloan fee in basis points (default: FLASHLOAN_FEE_BPS)
 * @param safetyBufferBps Safety buffer in basis points (default: SAFETY_BUFFER_BPS)
 * @returns Net debt token profit (can be negative)
 */
export function computeNetDebtToken(
  minOut: bigint,
  debtToCover: bigint,
  flashloanFeeBps: number = FLASHLOAN_FEE_BPS,
  safetyBufferBps: number = SAFETY_BUFFER_BPS
): bigint {
  const flashloanFee = (debtToCover * BigInt(flashloanFeeBps)) / 10000n;
  const safetyBuffer = (debtToCover * BigInt(safetyBufferBps)) / 10000n;
  return minOut - debtToCover - flashloanFee - safetyBuffer;
}
