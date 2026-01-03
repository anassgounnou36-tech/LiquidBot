// execution/liquidationPlanner.ts: Plan liquidations with correct token units and amounts

import { ethers } from 'ethers';
import { ProtocolDataProvider, type UserReserveData } from '../aave/protocolDataProvider.js';
import { getUsdPriceForAddress, getTokenDecimals } from '../prices/priceMath.js';
import { getHttpProvider } from '../providers/rpc.js';
import { metrics } from '../metrics/metrics.js';

/**
 * Candidate plan with oracle-based score
 */
export interface CandidatePlan {
  debtAsset: string;
  collateralAsset: string;
  debtToCover: bigint; // In debt token units
  expectedCollateralOut: bigint; // In collateral token units
  oracleScore: bigint; // Conservative BigInt score based on oracle math (1e18 scale)
  debtAssetDecimals: number;
  collateralAssetDecimals: number;
  liquidationBonusBps: number;
}

/**
 * Liquidation plan with all amounts in correct token units
 */
export interface LiquidationPlan {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: bigint; // In debt token units
  expectedCollateralOut: bigint; // In collateral token units
  debtAssetDecimals: number;
  collateralAssetDecimals: number;
  liquidationBonusBps: number;
  profitUsd: number; // Conservative profit estimate with haircut
  executionTimeMs: number; // Execution time for logging
}

/**
 * Pair score for selection
 */
interface PairScore {
  debtReserve: UserReserveData;
  collateralReserve: UserReserveData;
  score: number; // Conservative profit in USD with haircut
  oracleScoreBigInt: bigint; // Conservative profit in 1e18 scale (for CandidatePlan)
  debtUsd1e18: bigint;
  collateralUsd1e18: bigint;
  expectedCollateralOut: bigint;
  debtToCover: bigint;
  liquidationBonusBps: number;
}

/**
 * LiquidationPlanner: Compute liquidation parameters with correct token units
 */
export class LiquidationPlanner {
  private dataProvider: ProtocolDataProvider;
  private provider: ethers.JsonRpcProvider;
  private reserveConfigCache: Map<string, any> = new Map(); // address -> reserve config (persistent)

  constructor(dataProviderAddress: string) {
    this.dataProvider = new ProtocolDataProvider(dataProviderAddress);
    this.provider = getHttpProvider();
  }

  /**
   * Build candidate plans for a user (up to top N)
   * Returns up to TOP_N_PAIRS candidates sorted by oracleScore (descending)
   * Does NOT pick the final winner - that's done by the caller using real swap quotes
   */
  async buildCandidatePlans(user: string): Promise<CandidatePlan[]> {
    const startTime = Date.now();
    
    // Get all user reserves
    const reserves = await this.dataProvider.getAllUserReserves(user);
    
    if (reserves.length === 0) {
      console.warn(`[liquidationPlanner] No reserves found for user ${user}`);
      return [];
    }

    // Step 1: Find user's debt positions
    const debtPositions = reserves.filter(
      r => r.currentVariableDebt > 0n || r.currentStableDebt > 0n
    );

    if (debtPositions.length === 0) {
      console.warn(`[liquidationPlanner] No debt positions for user ${user}`);
      return [];
    }

    // Step 2: Find user's collateral positions
    const collateralPositions = reserves.filter(
      r => r.usageAsCollateralEnabled && r.currentATokenBalance > 0n
    );

    if (collateralPositions.length === 0) {
      console.warn(`[liquidationPlanner] No collateral positions for user ${user}`);
      return [];
    }

    // Step 3: Get top N scored pairs
    const topPairs = await this.selectTopPairs(debtPositions, collateralPositions);
    
    if (topPairs.length === 0) {
      console.warn(`[liquidationPlanner] Could not select any pairs for user ${user}`);
      return [];
    }

    // Step 4: Convert to CandidatePlan format
    const candidates: CandidatePlan[] = [];
    for (const pair of topPairs) {
      const debtDecimals = await getTokenDecimals(pair.debtReserve.underlyingAsset);
      const collateralDecimals = await getTokenDecimals(pair.collateralReserve.underlyingAsset);

      candidates.push({
        debtAsset: pair.debtReserve.underlyingAsset,
        collateralAsset: pair.collateralReserve.underlyingAsset,
        debtToCover: pair.debtToCover,
        expectedCollateralOut: pair.expectedCollateralOut,
        oracleScore: pair.oracleScoreBigInt,
        debtAssetDecimals: debtDecimals,
        collateralAssetDecimals: collateralDecimals,
        liquidationBonusBps: pair.liquidationBonusBps
      });
    }

    const executionTimeMs = Date.now() - startTime;
    metrics.recordPlannerTime(executionTimeMs);
    
    console.log(
      `[liquidationPlanner] Built ${candidates.length} candidate plans in ${executionTimeMs}ms for user ${user}`
    );
    
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(
        `[liquidationPlanner]   ${i + 1}. Debt: ${candidate.debtAsset.substring(0, 10)}... ` +
        `Collateral: ${candidate.collateralAsset.substring(0, 10)}... ` +
        `OracleScore: ${(Number(candidate.oracleScore) / 1e18).toFixed(4)}`
      );
    }

    return candidates;
  }

  /**
   * Build a complete liquidation plan for a user (legacy method - picks single best)
   * Computes debtToCover and expectedCollateralOut in correct token units
   */
  async buildPlan(user: string): Promise<LiquidationPlan | null> {
    const startTime = Date.now();
    
    // Get all user reserves
    const reserves = await this.dataProvider.getAllUserReserves(user);
    
    if (reserves.length === 0) {
      console.warn(`[liquidationPlanner] No reserves found for user ${user}`);
      return null;
    }

    // Step 1: Find user's debt positions
    const debtPositions = reserves.filter(
      r => r.currentVariableDebt > 0n || r.currentStableDebt > 0n
    );

    if (debtPositions.length === 0) {
      console.warn(`[liquidationPlanner] No debt positions for user ${user}`);
      return null;
    }

    // Step 2: Find user's collateral positions
    const collateralPositions = reserves.filter(
      r => r.usageAsCollateralEnabled && r.currentATokenBalance > 0n
    );

    if (collateralPositions.length === 0) {
      console.warn(`[liquidationPlanner] No collateral positions for user ${user}`);
      return null;
    }

    // Step 3: Select best debt and collateral pair by scoring
    const bestPair = await this.selectBestPair(debtPositions, collateralPositions);
    
    if (!bestPair) {
      console.warn(`[liquidationPlanner] Could not select pair for user ${user}`);
      return null;
    }

    const { debtReserve, collateralReserve, score, debtToCover, expectedCollateralOut, liquidationBonusBps } = bestPair;

    // Step 4: Get token decimals (use cached values)
    const debtDecimals = await getTokenDecimals(debtReserve.underlyingAsset);
    const collateralDecimals = await getTokenDecimals(collateralReserve.underlyingAsset);

    const executionTimeMs = Date.now() - startTime;
    
    // Record planner metrics
    metrics.recordPlannerTime(executionTimeMs);
    
    console.log(
      `[liquidationPlanner] Plan built in ${executionTimeMs}ms for user ${user}`
    );
    console.log(
      `[liquidationPlanner] Debt to cover: ${debtToCover.toString()} (50% of total)`
    );
    console.log(
      `[liquidationPlanner] Expected collateral out: ${expectedCollateralOut.toString()}`
    );
    console.log(
      `[liquidationPlanner] Liquidation bonus: ${liquidationBonusBps} BPS`
    );
    console.log(
      `[liquidationPlanner] Conservative profit: $${score.toFixed(2)}`
    );

    return {
      user,
      debtAsset: debtReserve.underlyingAsset,
      collateralAsset: collateralReserve.underlyingAsset,
      debtToCover,
      expectedCollateralOut,
      debtAssetDecimals: debtDecimals,
      collateralAssetDecimals: collateralDecimals,
      liquidationBonusBps,
      profitUsd: score,
      executionTimeMs
    };
  }

  /**
   * Select top N debt and collateral pairs by scoring
   * Returns up to TOP_N_PAIRS pairs sorted by score (descending)
   */
  private async selectTopPairs(
    debtPositions: UserReserveData[],
    collateralPositions: UserReserveData[]
  ): Promise<PairScore[]> {
    const TOP_N_PAIRS = 3; // Return up to top 3 pairs
    const CONSERVATIVE_HAIRCUT_BPS = 200; // 2% haircut for slippage/fees
    const CLOSE_FACTOR_BPS = 5000n; // 50%
    
    // PHASE 1: ASYNC PREFETCH - Gather all unique addresses
    const allAddresses = new Set<string>();
    
    for (const debtReserve of debtPositions) {
      allAddresses.add(debtReserve.underlyingAsset.toLowerCase());
    }
    
    for (const collateralReserve of collateralPositions) {
      allAddresses.add(collateralReserve.underlyingAsset.toLowerCase());
    }
    
    // Prefetch all prices concurrently
    const pricePromises = Array.from(allAddresses).map(async (address) => {
      try {
        const price = await getUsdPriceForAddress(address);
        return { address, price };
      } catch (err) {
        console.warn(`[liquidationPlanner] Failed to fetch price for ${address}:`, err instanceof Error ? err.message : err);
        return { address, price: null };
      }
    });
    
    // Prefetch all decimals concurrently
    const decimalsPromises = Array.from(allAddresses).map(async (address) => {
      try {
        const decimals = await getTokenDecimals(address);
        return { address, decimals };
      } catch (err) {
        console.warn(`[liquidationPlanner] Failed to fetch decimals for ${address}:`, err instanceof Error ? err.message : err);
        return { address, decimals: null };
      }
    });
    
    // Prefetch all reserve configs concurrently
    // Use persistent cache to avoid repeated fetches across plans
    const configPromises = Array.from(allAddresses).map(async (address) => {
      // Check persistent cache first
      if (this.reserveConfigCache.has(address)) {
        return { address, config: this.reserveConfigCache.get(address) };
      }
      
      try {
        const config = await this.dataProvider.getReserveConfigurationData(address);
        // Store in persistent cache
        this.reserveConfigCache.set(address, config);
        return { address, config };
      } catch (err) {
        console.warn(`[liquidationPlanner] Failed to fetch config for ${address}:`, err instanceof Error ? err.message : err);
        return { address, config: null };
      }
    });
    
    // Wait for all prefetches
    const [priceResults, decimalsResults, configResults] = await Promise.all([
      Promise.all(pricePromises),
      Promise.all(decimalsPromises),
      Promise.all(configPromises)
    ]);
    
    // Build caches
    const priceCache = new Map<string, bigint>();
    const decimalsCache = new Map<string, number>();
    const configCache = new Map<string, any>();
    
    for (const { address, price } of priceResults) {
      if (price !== null) {
        priceCache.set(address, price);
      }
    }
    
    for (const { address, decimals } of decimalsResults) {
      if (decimals !== null) {
        decimalsCache.set(address, decimals);
      }
    }
    
    for (const { address, config } of configResults) {
      if (config !== null) {
        configCache.set(address, config);
      }
    }
    
    // PHASE 2: SYNC SCORING - Pure BigInt math, no awaits
    const scoredPairs: PairScore[] = [];
    
    for (const debtReserve of debtPositions) {
      const totalDebt = debtReserve.currentVariableDebt + debtReserve.currentStableDebt;
      const debtToCover = (totalDebt * CLOSE_FACTOR_BPS) / 10000n;
      
      const debtAddress = debtReserve.underlyingAsset.toLowerCase();
      const debtPriceUsd1e18 = priceCache.get(debtAddress);
      const debtDecimals = decimalsCache.get(debtAddress);
      
      if (!debtPriceUsd1e18 || debtDecimals === undefined) {
        continue;
      }
      
      const debtUsd1e18 = this.calculateUsdValue(debtToCover, debtDecimals, debtPriceUsd1e18);
      
      for (const collateralReserve of collateralPositions) {
        const collateralAddress = collateralReserve.underlyingAsset.toLowerCase();
        const collateralPriceUsd1e18 = priceCache.get(collateralAddress);
        const collateralDecimals = decimalsCache.get(collateralAddress);
        const collateralConfig = configCache.get(collateralAddress);
        
        if (!collateralPriceUsd1e18 || collateralDecimals === undefined || !collateralConfig) {
          continue;
        }
        
        const liquidationBonusBps = collateralConfig.liquidationBonus > 10000 
          ? collateralConfig.liquidationBonus - 10000
          : 500;
        
        // Calculate expected collateral out (pure BigInt math)
        const expectedCollateralOut = this.calculateExpectedCollateral(
          debtToCover,
          debtDecimals,
          debtPriceUsd1e18,
          collateralDecimals,
          collateralPriceUsd1e18,
          liquidationBonusBps
        );
        
        // Check if we have enough collateral
        if (expectedCollateralOut > collateralReserve.currentATokenBalance) {
          continue;
        }
        
        // Calculate collateral out USD value (pure BigInt math)
        const collateralOutUsd1e18 = this.calculateUsdValue(
          expectedCollateralOut,
          collateralDecimals,
          collateralPriceUsd1e18
        );
        
        // Calculate conservative profit with haircut (pure BigInt math)
        const profitUsd1e18 = collateralOutUsd1e18 - debtUsd1e18;
        const haircutAmount = (profitUsd1e18 * BigInt(CONSERVATIVE_HAIRCUT_BPS)) / 10000n;
        const conservativeProfitUsd1e18 = profitUsd1e18 - haircutAmount;
        
        // Convert to number for scoring (safe because USD values are small)
        const score = Number(conservativeProfitUsd1e18) / 1e18;
        
        // Only consider profitable pairs
        if (score > 0) {
          scoredPairs.push({
            debtReserve,
            collateralReserve,
            score,
            oracleScoreBigInt: conservativeProfitUsd1e18,
            debtUsd1e18,
            collateralUsd1e18: collateralOutUsd1e18,
            expectedCollateralOut,
            debtToCover,
            liquidationBonusBps
          });
        }
      }
    }

    if (scoredPairs.length === 0) {
      return [];
    }

    // Sort by score (descending) and take top N
    scoredPairs.sort((a, b) => b.score - a.score);
    return scoredPairs.slice(0, TOP_N_PAIRS);
  }

  /**
   * Select best debt and collateral pair by scoring
   * Uses address-based price lookups (no symbol() calls)
   * Scores by conservative profit: collateralOut - debtToCover (in USD) with haircut
   * 
   * OPTIMIZED: Two-phase approach
   * Phase 1: Async prefetch all data
   * Phase 2: Sync scoring using cached data
   */
  private async selectBestPair(
    debtPositions: UserReserveData[],
    collateralPositions: UserReserveData[]
  ): Promise<PairScore | null> {
    const TOP_N_PAIRS = 3; // Only score top N pairs
    const CONSERVATIVE_HAIRCUT_BPS = 200; // 2% haircut for slippage/fees
    const CLOSE_FACTOR_BPS = 5000n; // 50%
    
    // PHASE 1: ASYNC PREFETCH - Gather all unique addresses
    const allAddresses = new Set<string>();
    
    for (const debtReserve of debtPositions) {
      allAddresses.add(debtReserve.underlyingAsset.toLowerCase());
    }
    
    for (const collateralReserve of collateralPositions) {
      allAddresses.add(collateralReserve.underlyingAsset.toLowerCase());
    }
    
    // Prefetch all prices concurrently
    const pricePromises = Array.from(allAddresses).map(async (address) => {
      try {
        const price = await getUsdPriceForAddress(address);
        return { address, price };
      } catch (err) {
        console.warn(`[liquidationPlanner] Failed to fetch price for ${address}:`, err instanceof Error ? err.message : err);
        return { address, price: null };
      }
    });
    
    // Prefetch all decimals concurrently
    const decimalsPromises = Array.from(allAddresses).map(async (address) => {
      try {
        const decimals = await getTokenDecimals(address);
        return { address, decimals };
      } catch (err) {
        console.warn(`[liquidationPlanner] Failed to fetch decimals for ${address}:`, err instanceof Error ? err.message : err);
        return { address, decimals: null };
      }
    });
    
    // Prefetch all reserve configs concurrently
    // Use persistent cache to avoid repeated fetches across plans
    const configPromises = Array.from(allAddresses).map(async (address) => {
      // Check persistent cache first
      if (this.reserveConfigCache.has(address)) {
        return { address, config: this.reserveConfigCache.get(address) };
      }
      
      try {
        const config = await this.dataProvider.getReserveConfigurationData(address);
        // Store in persistent cache
        this.reserveConfigCache.set(address, config);
        return { address, config };
      } catch (err) {
        console.warn(`[liquidationPlanner] Failed to fetch config for ${address}:`, err instanceof Error ? err.message : err);
        return { address, config: null };
      }
    });
    
    // Wait for all prefetches
    const [priceResults, decimalsResults, configResults] = await Promise.all([
      Promise.all(pricePromises),
      Promise.all(decimalsPromises),
      Promise.all(configPromises)
    ]);
    
    // Build caches
    const priceCache = new Map<string, bigint>();
    const decimalsCache = new Map<string, number>();
    const configCache = new Map<string, any>();
    
    for (const { address, price } of priceResults) {
      if (price !== null) {
        priceCache.set(address, price);
      }
    }
    
    for (const { address, decimals } of decimalsResults) {
      if (decimals !== null) {
        decimalsCache.set(address, decimals);
      }
    }
    
    for (const { address, config } of configResults) {
      if (config !== null) {
        configCache.set(address, config);
      }
    }
    
    // PHASE 2: SYNC SCORING - Pure BigInt math, no awaits
    const scoredPairs: PairScore[] = [];
    
    for (const debtReserve of debtPositions) {
      const totalDebt = debtReserve.currentVariableDebt + debtReserve.currentStableDebt;
      const debtToCover = (totalDebt * CLOSE_FACTOR_BPS) / 10000n;
      
      const debtAddress = debtReserve.underlyingAsset.toLowerCase();
      const debtPriceUsd1e18 = priceCache.get(debtAddress);
      const debtDecimals = decimalsCache.get(debtAddress);
      
      if (!debtPriceUsd1e18 || debtDecimals === undefined) {
        continue;
      }
      
      const debtUsd1e18 = this.calculateUsdValue(debtToCover, debtDecimals, debtPriceUsd1e18);
      
      for (const collateralReserve of collateralPositions) {
        const collateralAddress = collateralReserve.underlyingAsset.toLowerCase();
        const collateralPriceUsd1e18 = priceCache.get(collateralAddress);
        const collateralDecimals = decimalsCache.get(collateralAddress);
        const collateralConfig = configCache.get(collateralAddress);
        
        if (!collateralPriceUsd1e18 || collateralDecimals === undefined || !collateralConfig) {
          continue;
        }
        
        const liquidationBonusBps = collateralConfig.liquidationBonus > 10000 
          ? collateralConfig.liquidationBonus - 10000
          : 500;
        
        // Calculate expected collateral out (pure BigInt math)
        const expectedCollateralOut = this.calculateExpectedCollateral(
          debtToCover,
          debtDecimals,
          debtPriceUsd1e18,
          collateralDecimals,
          collateralPriceUsd1e18,
          liquidationBonusBps
        );
        
        // Check if we have enough collateral
        if (expectedCollateralOut > collateralReserve.currentATokenBalance) {
          continue;
        }
        
        // Calculate collateral out USD value (pure BigInt math)
        const collateralOutUsd1e18 = this.calculateUsdValue(
          expectedCollateralOut,
          collateralDecimals,
          collateralPriceUsd1e18
        );
        
        // Calculate conservative profit with haircut (pure BigInt math)
        const profitUsd1e18 = collateralOutUsd1e18 - debtUsd1e18;
        const haircutAmount = (profitUsd1e18 * BigInt(CONSERVATIVE_HAIRCUT_BPS)) / 10000n;
        const conservativeProfitUsd1e18 = profitUsd1e18 - haircutAmount;
        
        // Convert to number for scoring (safe because USD values are small)
        const score = Number(conservativeProfitUsd1e18) / 1e18;
        
        // Only consider profitable pairs
        if (score > 0) {
          scoredPairs.push({
            debtReserve,
            collateralReserve,
            score,
            oracleScoreBigInt: conservativeProfitUsd1e18,
            debtUsd1e18,
            collateralUsd1e18: collateralOutUsd1e18,
            expectedCollateralOut,
            debtToCover,
            liquidationBonusBps
          });
        }
      }
    }

    if (scoredPairs.length === 0) {
      return null;
    }

    // Sort by score (descending) and take top N
    scoredPairs.sort((a, b) => b.score - a.score);
    const topPairs = scoredPairs.slice(0, TOP_N_PAIRS);

    console.log(`[liquidationPlanner] Scored ${scoredPairs.length} pairs, top ${topPairs.length}:`);
    for (let i = 0; i < topPairs.length; i++) {
      const pair = topPairs[i];
      console.log(
        `[liquidationPlanner]   ${i + 1}. Debt: ${pair.debtReserve.underlyingAsset.substring(0, 10)}... ` +
        `Collateral: ${pair.collateralReserve.underlyingAsset.substring(0, 10)}... ` +
        `Score: $${pair.score.toFixed(2)}`
      );
    }

    // Return best scoring pair
    return topPairs[0];
  }

  /**
   * Calculate expected collateral seized (pure BigInt math)
   * Formula: collateralOut = debtToCover * debtPrice / collateralPrice * (1 + bonus)
   */
  private calculateExpectedCollateral(
    debtToCover: bigint,
    debtDecimals: number,
    debtPriceUsd1e18: bigint,
    collateralDecimals: number,
    collateralPriceUsd1e18: bigint,
    liquidationBonusBps: number
  ): bigint {
    // Convert debtToCover to 1e18 scale
    let debtToCover1e18: bigint;
    if (debtDecimals === 18) {
      debtToCover1e18 = debtToCover;
    } else if (debtDecimals < 18) {
      debtToCover1e18 = debtToCover * (10n ** BigInt(18 - debtDecimals));
    } else {
      debtToCover1e18 = debtToCover / (10n ** BigInt(debtDecimals - 18));
    }

    // Calculate debt value in USD (1e18 scale)
    const debtValueUsd1e18 = (debtToCover1e18 * debtPriceUsd1e18) / (10n ** 18n);

    // Calculate collateral amount needed (1e18 scale)
    const collateralAmount1e18 = (debtValueUsd1e18 * (10n ** 18n)) / collateralPriceUsd1e18;

    // Apply liquidation bonus
    const collateralWithBonus1e18 = (collateralAmount1e18 * (10000n + BigInt(liquidationBonusBps))) / 10000n;

    // Convert back to collateral token decimals
    let collateralOut: bigint;
    if (collateralDecimals === 18) {
      collateralOut = collateralWithBonus1e18;
    } else if (collateralDecimals < 18) {
      collateralOut = collateralWithBonus1e18 / (10n ** BigInt(18 - collateralDecimals));
    } else {
      collateralOut = collateralWithBonus1e18 * (10n ** BigInt(collateralDecimals - 18));
    }

    return collateralOut;
  }

  /**
   * Calculate USD value from token amount (pure BigInt math)
   * Returns USD value in 1e18 scale
   */
  private calculateUsdValue(
    amount: bigint,
    decimals: number,
    priceUsd1e18: bigint
  ): bigint {
    // Normalize amount to 1e18
    let amount1e18: bigint;
    if (decimals === 18) {
      amount1e18 = amount;
    } else if (decimals < 18) {
      amount1e18 = amount * (10n ** BigInt(18 - decimals));
    } else {
      amount1e18 = amount / (10n ** BigInt(decimals - 18));
    }

    // Calculate USD value (1e18 scale)
    return (amount1e18 * priceUsd1e18) / (10n ** 18n);
  }
}
