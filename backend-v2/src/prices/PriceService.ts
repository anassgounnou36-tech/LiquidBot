// prices/PriceService.ts: Price service orchestrator

import { ChainlinkListener } from './ChainlinkListener.js';
import { PythListener } from './PythListener.js';

export interface PriceUpdate {
  symbol: string;
  price: number;
  source: 'chainlink' | 'pyth';
  timestamp: number;
}

type PriceUpdateCallback = (update: PriceUpdate) => void;

/**
 * PriceService: Orchestrates Chainlink OCR2 and Pyth price listeners
 */
export class PriceService {
  private chainlinkListener: ChainlinkListener;
  private pythListener: PythListener;
  private callbacks: PriceUpdateCallback[] = [];

  constructor() {
    this.chainlinkListener = new ChainlinkListener();
    this.pythListener = new PythListener();

    // Wire up callbacks
    this.chainlinkListener.onPriceUpdate((update) => {
      this.notifyCallbacks({
        symbol: update.symbol,
        price: Number(update.answer) / 1e8, // Chainlink uses 8 decimals
        source: 'chainlink',
        timestamp: update.timestamp
      });
    });

    this.pythListener.onPriceUpdate((update) => {
      this.notifyCallbacks({
        symbol: update.symbol,
        price: update.price,
        source: 'pyth',
        timestamp: update.timestamp
      });
    });
  }

  /**
   * Add a Chainlink price feed
   */
  addChainlinkFeed(symbol: string, feedAddress: string): void {
    this.chainlinkListener.addFeed(symbol, feedAddress);
  }

  /**
   * Register callback for price updates
   */
  onPriceUpdate(callback: PriceUpdateCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start all price listeners
   */
  async start(): Promise<void> {
    console.log('[price-service] Starting price listeners');
    await Promise.all([
      this.chainlinkListener.start(),
      this.pythListener.start()
    ]);
  }

  /**
   * Stop all price listeners
   */
  async stop(): Promise<void> {
    console.log('[price-service] Stopping price listeners');
    await Promise.all([
      this.chainlinkListener.stop(),
      this.pythListener.stop()
    ]);
  }

  /**
   * Notify all callbacks
   */
  private notifyCallbacks(update: PriceUpdate): void {
    for (const callback of this.callbacks) {
      try {
        callback(update);
      } catch (err) {
        console.error('[price-service] Error in callback:', err);
      }
    }
  }
}
