// metrics/metrics.ts: Performance metrics for liquidation pipeline

/**
 * Metrics for tracking liquidation performance
 */
interface LiquidationMetrics {
  plannerBuildMs: number;
  triggerToPlanMs: number;
  planToTxSentMs: number;
  txSentToMinedMs: number;
}

/**
 * Planner performance statistics
 */
interface PlannerStats {
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
}

/**
 * MetricsCollector: Track and report liquidation pipeline performance
 */
export class MetricsCollector {
  private plannerTimings: number[] = [];
  private liquidationMetrics: LiquidationMetrics[] = [];
  private pendingAttemptsCount = 0;
  private pendingSkippedRechecksCount = 0;
  private lateInclusionMissesCount = 0;
  private readonly maxSamples = 1000; // Keep last 1000 samples

  /**
   * Record planner execution time
   */
  recordPlannerTime(timeMs: number): void {
    this.plannerTimings.push(timeMs);
    
    // Keep only last maxSamples
    if (this.plannerTimings.length > this.maxSamples) {
      this.plannerTimings.shift();
    }
  }

  /**
   * Record full liquidation metrics
   */
  recordLiquidation(metrics: LiquidationMetrics): void {
    this.liquidationMetrics.push(metrics);
    
    // Keep only last maxSamples
    if (this.liquidationMetrics.length > this.maxSamples) {
      this.liquidationMetrics.shift();
    }
  }

  /**
   * Increment pending attempts counter
   */
  incrementPendingAttempts(): void {
    this.pendingAttemptsCount++;
  }

  /**
   * Increment pending skipped rechecks counter
   */
  incrementPendingSkippedRechecks(): void {
    this.pendingSkippedRechecksCount++;
  }

  /**
   * Increment late inclusion misses counter
   */
  incrementLateInclusionMisses(): void {
    this.lateInclusionMissesCount++;
  }

  /**
   * Get pending-related metrics
   */
  getPendingMetrics() {
    return {
      pendingAttempts: this.pendingAttemptsCount,
      pendingSkippedRechecks: this.pendingSkippedRechecksCount,
      lateInclusionMisses: this.lateInclusionMissesCount
    };
  }

  /**
   * Get planner statistics
   */
  getPlannerStats(): PlannerStats | null {
    if (this.plannerTimings.length === 0) {
      return null;
    }

    const sorted = [...this.plannerTimings].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      samples: sorted,
      p50: sorted[Math.floor(len * 0.5)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
      avg: sorted.reduce((a, b) => a + b, 0) / len,
      min: sorted[0],
      max: sorted[len - 1]
    };
  }

  /**
   * Get average metrics for liquidation pipeline
   */
  getLiquidationStats(): {
    avgPlannerMs: number;
    avgTriggerToPlanMs: number;
    avgPlanToTxSentMs: number;
    avgTxSentToMinedMs: number;
    samples: number;
  } | null {
    if (this.liquidationMetrics.length === 0) {
      return null;
    }

    const len = this.liquidationMetrics.length;
    const sum = this.liquidationMetrics.reduce(
      (acc, m) => ({
        plannerBuildMs: acc.plannerBuildMs + m.plannerBuildMs,
        triggerToPlanMs: acc.triggerToPlanMs + m.triggerToPlanMs,
        planToTxSentMs: acc.planToTxSentMs + m.planToTxSentMs,
        txSentToMinedMs: acc.txSentToMinedMs + m.txSentToMinedMs
      }),
      { plannerBuildMs: 0, triggerToPlanMs: 0, planToTxSentMs: 0, txSentToMinedMs: 0 }
    );

    return {
      avgPlannerMs: sum.plannerBuildMs / len,
      avgTriggerToPlanMs: sum.triggerToPlanMs / len,
      avgPlanToTxSentMs: sum.planToTxSentMs / len,
      avgTxSentToMinedMs: sum.txSentToMinedMs / len,
      samples: len
    };
  }

  /**
   * Log current statistics
   */
  logStats(): void {
    const plannerStats = this.getPlannerStats();
    const liqStats = this.getLiquidationStats();
    const pendingMetrics = this.getPendingMetrics();

    if (plannerStats) {
      console.log('[metrics] Planner Performance:');
      console.log(`  Samples: ${plannerStats.samples.length}`);
      console.log(`  P50: ${plannerStats.p50.toFixed(2)}ms`);
      console.log(`  P95: ${plannerStats.p95.toFixed(2)}ms`);
      console.log(`  P99: ${plannerStats.p99.toFixed(2)}ms`);
      console.log(`  Avg: ${plannerStats.avg.toFixed(2)}ms`);
      console.log(`  Min: ${plannerStats.min.toFixed(2)}ms`);
      console.log(`  Max: ${plannerStats.max.toFixed(2)}ms`);
    }

    if (liqStats) {
      console.log('[metrics] Liquidation Pipeline:');
      console.log(`  Samples: ${liqStats.samples}`);
      console.log(`  Avg Planner: ${liqStats.avgPlannerMs.toFixed(2)}ms`);
      console.log(`  Avg Trigger→Plan: ${liqStats.avgTriggerToPlanMs.toFixed(2)}ms`);
      console.log(`  Avg Plan→TxSent: ${liqStats.avgPlanToTxSentMs.toFixed(2)}ms`);
      console.log(`  Avg TxSent→Mined: ${liqStats.avgTxSentToMinedMs.toFixed(2)}ms`);
    }

    // Log pending metrics
    console.log('[metrics] Pending Execution:');
    console.log(`  Pending Attempts: ${pendingMetrics.pendingAttempts}`);
    console.log(`  Pending Skipped Rechecks: ${pendingMetrics.pendingSkippedRechecks}`);
    console.log(`  Late Inclusion Misses: ${pendingMetrics.lateInclusionMisses}`);
  }

  /**
   * Start periodic logging
   */
  startPeriodicLogging(intervalMs: number = 60000): NodeJS.Timeout {
    return setInterval(() => {
      this.logStats();
    }, intervalMs);
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();
