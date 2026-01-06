// verifierLoop.ts: Bounded batch HF verification loop (250ms interval)

import type { DirtyQueue } from '../realtime/dirtyQueue.js';
import type { HealthFactorChecker } from '../risk/HealthFactorChecker.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';
import { config } from '../config/index.js';

/**
 * VerifierLoop processes dirty users in bounded batches
 */
export class VerifierLoop {
  private dirtyQueue: DirtyQueue;
  private hfChecker: HealthFactorChecker;
  private activeRiskSet: ActiveRiskSet;
  private intervalMs: number;
  private batchSize: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;
  private onExecute?: (user: string, healthFactor: number, debtUsd1e18: bigint) => Promise<void>;

  constructor(
    dirtyQueue: DirtyQueue,
    hfChecker: HealthFactorChecker,
    activeRiskSet: ActiveRiskSet,
    options?: {
      intervalMs?: number;
      batchSize?: number;
      onExecute?: (user: string, healthFactor: number, debtUsd1e18: bigint) => Promise<void>;
    }
  ) {
    this.dirtyQueue = dirtyQueue;
    this.hfChecker = hfChecker;
    this.activeRiskSet = activeRiskSet;
    this.intervalMs = options?.intervalMs || 250;
    this.batchSize = options?.batchSize || 200;
    this.onExecute = options?.onExecute;
  }

  /**
   * Start the verifier loop
   */
  start(): void {
    if (this.running) {
      console.warn('[verifierLoop] Already running');
      return;
    }

    this.running = true;
    console.log(
      `[verifierLoop] Starting (interval=${this.intervalMs}ms, batchSize=${this.batchSize})`
    );

    this.intervalHandle = setInterval(() => {
      this.tick().catch(err => {
        console.error('[verifierLoop] Tick error:', err);
      });
    }, this.intervalMs);
  }

  /**
   * Stop the verifier loop
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log('[verifierLoop] Stopped');
  }

  /**
   * Process one batch of dirty users
   */
  private async tick(): Promise<void> {
    const batch = this.dirtyQueue.takeBatch(this.batchSize);
    if (batch.length === 0) {
      return;
    }

    const results = await this.hfChecker.checkBatch(batch, batch.length);
    
    for (const result of results) {
      // Update active risk set with fresh HF and debtUsd1e18
      this.activeRiskSet.updateHF(result.address, result.healthFactor, result.debtUsd1e18, result.totalCollateralBase);

      // Check if user should be executed
      const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
      const shouldExecute =
        result.healthFactor <= config.HF_THRESHOLD_EXECUTE &&
        result.debtUsd1e18 >= minDebtUsd1e18;

      if (shouldExecute && this.onExecute) {
        try {
          await this.onExecute(result.address, result.healthFactor, result.debtUsd1e18);
        } catch (err) {
          console.error(
            `[verifierLoop] Execution failed for ${result.address}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }

  /**
   * Get loop stats
   */
  getStats() {
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      queueSize: this.dirtyQueue.size()
    };
  }
}
