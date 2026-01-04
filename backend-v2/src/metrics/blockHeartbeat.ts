// metrics/blockHeartbeat.ts: Per-block heartbeat logging for system health monitoring

import { config } from '../config/index.js';
import { getPriceSourceCounters } from '../prices/priceMath.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';

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
 * Log block heartbeat with system health metrics
 * Includes: risk set sizes, min HF among watched, price source counters
 * 
 * @param blockNumber Current block number
 * @param riskSet Active risk set instance
 */
export function logHeartbeat(blockNumber: number, riskSet: ActiveRiskSet): void {
  // Check if heartbeat logging is enabled
  if (!config.LOG_BLOCK_HEARTBEAT) {
    return;
  }
  
  // Check if we should log this block (every N blocks)
  const everyN = config.BLOCK_HEARTBEAT_EVERY_N;
  if (blockNumber % everyN !== 0) {
    return;
  }
  
  // Gather metrics
  const allUsers = riskSet.getAll();
  const belowThreshold = riskSet.getBelowThreshold();
  
  // Find minimum HF among watched users
  let minHF: number | null = null;
  for (const user of allUsers) {
    if (user.healthFactor < Infinity) {
      if (minHF === null || user.healthFactor < minHF) {
        minHF = user.healthFactor;
      }
    }
  }
  
  // Get price source counters
  const priceCounters = getPriceSourceCounters();
  
  // Log heartbeat
  console.log(
    `[heartbeat] block=${blockNumber} ` +
    `riskSet=${allUsers.length} ` +
    `belowThreshold=${belowThreshold.length} ` +
    `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'} ` +
    `priceHits(listener=${priceCounters.listenerHits},local=${priceCounters.localHits},rpc=${priceCounters.rpcFallbacks})`
  );
}
