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
 * Includes: risk set sizes, min HF among watched, price source counter deltas
 * 
 * @param blockNumber Current block number
 * @param riskSet Active risk set instance
 */
export function logHeartbeat(blockNumber: number, riskSet: ActiveRiskSet): void {
  // Check if heartbeat logging is enabled
  if (!config.LOG_BLOCK_HEARTBEAT) {
    return;
  }
  
  // Gather metrics
  const allUsers = riskSet.getAll();
  const belowThreshold = riskSet.getBelowThreshold();
  
  // Find minimum HF among watched (below-threshold) users only
  let minHF: number | null = null;
  let minHFUser: string | null = null;
  for (const user of belowThreshold) {
    const hf = user.healthFactor;
    
    // Defensive guard against invalid values
    if (!Number.isFinite(hf)) continue;
    
    if (minHF === null || hf < minHF) {
      minHF = hf;
      minHFUser = user.address;
    }
  }
  
  // Get current price source counters
  const currentCounters = getPriceSourceCounters();
  
  // First heartbeat: initialize baseline without showing startup accumulation
  if (lastPriceCounters === null) {
    lastPriceCounters = {
      listenerHits: currentCounters.listenerHits,
      localHits: currentCounters.localHits,
      rpcFallbacks: currentCounters.rpcFallbacks,
    };
    
    // Log heartbeat with zeros to establish baseline
    console.log(
      `[heartbeat] block=${blockNumber} ` +
      `riskSet=${allUsers.length} ` +
      `belowThreshold=${belowThreshold.length} ` +
      `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'}` +
      (config.LOG_MINHF_USER && minHFUser ? ` user=${minHFUser}` : '') +
      ` priceHits(+listener=0,+local=0,+rpc=0)`
    );
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
  
  // Log heartbeat with delta counters
  console.log(
    `[heartbeat] block=${blockNumber} ` +
    `riskSet=${allUsers.length} ` +
    `belowThreshold=${belowThreshold.length} ` +
    `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'}` +
    (config.LOG_MINHF_USER && minHFUser ? ` user=${minHFUser}` : '') +
    ` priceHits(+listener=${deltaCounters.listenerHits},+local=${deltaCounters.localHits},+rpc=${deltaCounters.rpcFallbacks})`
  );
}
