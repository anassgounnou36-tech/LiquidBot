// metrics/blockHeartbeat.ts: Per-block heartbeat logging for system health monitoring

import { config } from '../config/index.js';
import { getPriceSourceCounters } from '../prices/priceMath.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';
import type { PredictiveLoop } from '../predictive/PredictiveLoop.js';

/**
 * Heartbeat metrics interface
 */
export interface HeartbeatMetrics {
  riskSetSize: number;
  minHF: number | null;
  belowThreshold: number;
  priceCounters: {
    listenerHits: number;
    localHits: number;
    rpcFallbacks: number;
  };
}

/**
 * Last known price counters for delta calculation
 * Initialized to null to detect first heartbeat
 */
let lastPriceCounters: {
  listenerHits: number;
  localHits: number;
  rpcFallbacks: number;
} | null = null;

/**
 * Log block heartbeat with system health metrics
 * Includes: risk set sizes, actionable min HF among watched, price source counter deltas, predictive stats
 * 
 * @param blockNumber Current block number
 * @param riskSet Active risk set instance
 * @param predictiveLoop Optional predictive loop for stats
 */
export function logHeartbeat(
  blockNumber: number, 
  riskSet: ActiveRiskSet,
  predictiveLoop?: PredictiveLoop
): void {
  // Check if heartbeat logging is enabled
  if (!config.LOG_BLOCK_HEARTBEAT) {
    return;
  }
  
  // Gather metrics
  const allUsers = riskSet.getAll();
  const belowThreshold = riskSet.getBelowThreshold();
  
  // Compute minimum debt threshold
  const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
  
  // Find minimum HF among ACTIONABLE watched users only
  // Actionable = debtUsd >= MIN_DEBT_USD AND collateral > 0 AND finite HF
  let minHF: number | null = null;
  let minHFUser: string | null = null;
  
  for (const user of belowThreshold) {
    const hf = user.healthFactor;
    
    // Check actionable criteria: must have real collateral to liquidate
    const isActionable = 
      user.lastDebtUsd1e18 >= minDebtUsd1e18 &&
      Number.isFinite(hf) &&
      user.totalCollateralBase > 0n; // Must have collateral to seize
    
    if (!isActionable) continue;
    
    if (minHF === null || hf < minHF) {
      minHF = hf;
      minHFUser = user.address;
    }
  }
  
  // Get current price source counters
  const currentCounters = getPriceSourceCounters();
  
  // Get predictive stats if available
  let predictiveStats = null;
  if (predictiveLoop) {
    const stats = predictiveLoop.getStats();
    predictiveStats = {
      pythTicks: stats.pythTicksSeen,
      triggers: stats.pythTriggers,
      affectedUsers: stats.affectedUsersTotal,
      rescored: stats.rescoredUsers,
      plansPrepared: stats.plansPrepared,
      planCacheSize: stats.plansCacheSize
    };
  }
  
  // First heartbeat: initialize baseline without showing startup accumulation
  if (lastPriceCounters === null) {
    lastPriceCounters = {
      listenerHits: currentCounters.listenerHits,
      localHits: currentCounters.localHits,
      rpcFallbacks: currentCounters.rpcFallbacks,
    };
    
    // Log heartbeat with zeros to establish baseline
    let logMsg = 
      `[heartbeat] block=${blockNumber} ` +
      `riskSet=${allUsers.length} ` +
      `belowThreshold=${belowThreshold.length} ` +
      `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'} ` +
      `priceHits(+listener=0,+local=0,+rpc=0)`;
    
    if (predictiveStats) {
      logMsg += ` pyth(ticks=${predictiveStats.pythTicks},triggers=${predictiveStats.triggers},` +
                `affected=${predictiveStats.affectedUsers},rescored=${predictiveStats.rescored},` +
                `plans=${predictiveStats.plansPrepared},cacheSize=${predictiveStats.planCacheSize})`;
    }
    
    // Optionally log minHF user address
    if (config.LOG_MINHF_USER && minHFUser) {
      logMsg += ` minHFUser=${minHFUser.substring(0, 10)}...`;
    }
    
    console.log(logMsg);
    return;
  }
  
  // Calculate deltas since last heartbeat
  const deltaCounters = {
    listenerHits: currentCounters.listenerHits - lastPriceCounters.listenerHits,
    localHits: currentCounters.localHits - lastPriceCounters.localHits,
    rpcFallbacks: currentCounters.rpcFallbacks - lastPriceCounters.rpcFallbacks,
  };
  
  // Update last known counters
  lastPriceCounters = {
    listenerHits: currentCounters.listenerHits,
    localHits: currentCounters.localHits,
    rpcFallbacks: currentCounters.rpcFallbacks,
  };
  
  // Log heartbeat with delta counters and predictive stats
  let logMsg = 
    `[heartbeat] block=${blockNumber} ` +
    `riskSet=${allUsers.length} ` +
    `belowThreshold=${belowThreshold.length} ` +
    `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'} ` +
    `priceHits(+listener=${deltaCounters.listenerHits},+local=${deltaCounters.localHits},+rpc=${deltaCounters.rpcFallbacks})`;
  
  if (predictiveStats) {
    logMsg += ` pyth(ticks=${predictiveStats.pythTicks},triggers=${predictiveStats.triggers},` +
              `affected=${predictiveStats.affectedUsers},rescored=${predictiveStats.rescored},` +
              `plans=${predictiveStats.plansPrepared},cacheSize=${predictiveStats.planCacheSize})`;
  }
  
  // Optionally log minHF user address
  if (config.LOG_MINHF_USER && minHFUser) {
    logMsg += ` minHFUser=${minHFUser.substring(0, 10)}...`;
  }
  
  console.log(logMsg);
}
