// realtime/RealtimeOrchestrator.ts: Coordinate block/event/price listeners

import { ActiveRiskSet } from '../risk/ActiveRiskSet.js';
import { HealthFactorChecker } from '../risk/HealthFactorChecker.js';
import { PriceService } from '../prices/PriceService.js';
import { getWsProvider } from '../providers/ws.js';
import { config } from '../config/index.js';

/**
 * RealtimeOrchestrator: Wire up block listener → HF checks → price triggers
 * PR1 scope: Basic foundation only, no execution path
 */
export class RealtimeOrchestrator {
  private riskSet: ActiveRiskSet;
  private hfChecker: HealthFactorChecker;
  private priceService: PriceService;
  private isRunning = false;

  constructor(riskSet: ActiveRiskSet, priceService: PriceService) {
    this.riskSet = riskSet;
    this.hfChecker = new HealthFactorChecker();
    this.priceService = priceService;
  }

  /**
   * Start real-time monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[realtime] Already running');
      return;
    }

    console.log('[realtime] Starting orchestrator');
    this.isRunning = true;

    // Start price listeners
    await this.priceService.start();

    // Subscribe to price updates
    this.priceService.onPriceUpdate((update) => {
      this.handlePriceUpdate(update).catch(err => {
        console.error('[realtime] Error handling price update:', err);
      });
    });

    // Subscribe to new blocks
    const provider = getWsProvider();
    provider.on('block', (blockNumber: number) => {
      this.handleNewBlock(blockNumber).catch(err => {
        console.error('[realtime] Error handling new block:', err);
      });
    });

    console.log('[realtime] Orchestrator started');
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    console.log('[realtime] Stopping orchestrator');
    this.isRunning = false;

    await this.priceService.stop();

    const provider = getWsProvider();
    provider.removeAllListeners();
  }

  /**
   * Handle new block: check HFs for at-risk users
   */
  private async handleNewBlock(blockNumber: number): Promise<void> {
    console.log(`[realtime] New block ${blockNumber}`);

    // Get users below threshold
    const atRiskUsers = this.riskSet.getBelowThreshold();
    
    if (atRiskUsers.length === 0) {
      return;
    }

    console.log(`[realtime] Checking ${atRiskUsers.length} at-risk users`);

    // Batch check HFs
    const results = await this.hfChecker.checkBatch(
      atRiskUsers.map(u => u.address),
      100 // batch size
    );

    // Update risk set with fresh HFs
    for (const result of results) {
      this.riskSet.updateHF(result.address, result.healthFactor);

      // Check if liquidatable (HF < execute threshold)
      if (result.healthFactor < config.HF_THRESHOLD_EXECUTE) {
        console.log(
          `[realtime] LIQUIDATABLE: user=${result.address} hf=${result.healthFactor.toFixed(4)} ` +
          `block=${blockNumber}`
        );
        // TODO PR2: Trigger execution
      }
    }
  }

  /**
   * Handle price update: recheck affected users
   */
  private async handlePriceUpdate(update: { symbol: string; price: number; source: string }): Promise<void> {
    console.log(
      `[realtime] Price update: ${update.symbol}=${update.price.toFixed(2)} (source=${update.source})`
    );

    // Get all at-risk users (price changes affect everyone)
    const atRiskUsers = this.riskSet.getBelowThreshold();
    
    if (atRiskUsers.length === 0) {
      return;
    }

    console.log(`[realtime] Price-triggered recheck for ${atRiskUsers.length} users`);

    // Batch check HFs
    const results = await this.hfChecker.checkBatch(
      atRiskUsers.map(u => u.address),
      50 // smaller batch for price-triggered checks
    );

    // Update risk set
    for (const result of results) {
      this.riskSet.updateHF(result.address, result.healthFactor);

      if (result.healthFactor < config.HF_THRESHOLD_EXECUTE) {
        console.log(
          `[realtime] LIQUIDATABLE (price-trigger): user=${result.address} ` +
          `hf=${result.healthFactor.toFixed(4)} trigger=${update.symbol}`
        );
        // TODO PR2: Trigger execution
      }
    }
  }
}
