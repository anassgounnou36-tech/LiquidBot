// prices/ChainlinkListener.ts: Chainlink OCR2 price feed listener
// STRICT: Subscribe ONLY to OCR2 NewTransmission events, NOT AnswerUpdated (prevents duplicate triggers)

import { Contract, EventLog, Interface } from 'ethers';
import { getWsProvider } from '../providers/ws.js';

// Chainlink OCR2 Aggregator ABI (NewTransmission only)
const CHAINLINK_AGG_ABI = [
  'event NewTransmission(uint32 indexed aggregatorRoundId, int192 answer, address transmitter, int192[] observations, bytes observers, bytes32 rawReportContext)'
];

export interface ChainlinkPriceUpdate {
  symbol: string;
  feedAddress: string;
  answer: bigint;
  roundId: number;
  timestamp: number;
}

type PriceUpdateCallback = (update: ChainlinkPriceUpdate) => void;

/**
 * ChainlinkListener: Subscribe to Chainlink OCR2 NewTransmission events
 * 
 * CRITICAL: Only subscribes to NewTransmission (OCR2), NOT AnswerUpdated.
 * This prevents duplicate price-trigger scans (per old bot patterns).
 */
export class ChainlinkListener {
  private feeds: Map<string, string> = new Map(); // symbol -> feedAddress
  private callbacks: PriceUpdateCallback[] = [];
  private dedupeCache: Set<string> = new Set(); // roundId:feedAddress
  private contracts: Map<string, Contract> = new Map(); // feedAddress -> Contract

  /**
   * Add a price feed to monitor
   * @param symbol Asset symbol (e.g., "WETH", "USDC")
   * @param feedAddress Chainlink feed contract address
   */
  addFeed(symbol: string, feedAddress: string): void {
    this.feeds.set(symbol, feedAddress.toLowerCase());
    console.log(`[chainlink] Added feed: ${symbol} -> ${feedAddress}`);
  }

  /**
   * Register callback for price updates
   */
  onPriceUpdate(callback: PriceUpdateCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start listening to all configured feeds
   */
  async start(): Promise<void> {
    if (this.feeds.size === 0) {
      console.log('[chainlink] No feeds configured, skipping start');
      return;
    }

    const provider = getWsProvider();
    const iface = new Interface(CHAINLINK_AGG_ABI);
    const newTransmissionTopic = iface.getEvent('NewTransmission')?.topicHash || '';

    console.log(`[chainlink] Starting listeners for ${this.feeds.size} feed(s)`);

    for (const [symbol, feedAddress] of this.feeds) {
      try {
        // Create contract instance for this feed
        const contract = new Contract(feedAddress, CHAINLINK_AGG_ABI, provider);
        this.contracts.set(feedAddress, contract);

        // Subscribe to NewTransmission ONLY (OCR2 event)
        const filter = {
          address: feedAddress,
          topics: [newTransmissionTopic]
        };

        provider.on(filter, (log: EventLog) => {
          this.handleLog(symbol, feedAddress, log).catch(err => {
            console.error(`[chainlink] Error handling NewTransmission for ${symbol}:`, err);
          });
        });

        console.log(`[chainlink] Subscribed to ${symbol} (NewTransmission only)`);
      } catch (err) {
        console.warn(`[chainlink] Failed to subscribe to ${symbol}:`, err);
      }
    }

    // Clear dedupe cache every 10 minutes
    setInterval(() => {
      this.dedupeCache.clear();
    }, 10 * 60 * 1000);
  }

  /**
   * Handle incoming NewTransmission log
   */
  private async handleLog(symbol: string, feedAddress: string, log: EventLog): Promise<void> {
    try {
      const iface = new Interface(CHAINLINK_AGG_ABI);
      const decoded = iface.parseLog({
        topics: log.topics as string[],
        data: log.data
      });

      if (!decoded) return;

      const roundId = Number(decoded.args.aggregatorRoundId);
      const answer = BigInt(decoded.args.answer);

      // Dedupe by roundId:feedAddress
      const dedupeKey = `${roundId}:${feedAddress}`;
      if (this.dedupeCache.has(dedupeKey)) {
        return;
      }
      this.dedupeCache.add(dedupeKey);

      // Notify callbacks
      const update: ChainlinkPriceUpdate = {
        symbol,
        feedAddress,
        answer,
        roundId,
        timestamp: Date.now()
      };

      for (const callback of this.callbacks) {
        try {
          callback(update);
        } catch (err) {
          console.error('[chainlink] Error in callback:', err);
        }
      }

      console.log(
        `[chainlink] NewTransmission: ${symbol} roundId=${roundId} answer=${answer.toString()}`
      );
    } catch (err) {
      console.error('[chainlink] Error parsing log:', err);
    }
  }

  /**
   * Stop listening and clean up
   */
  async stop(): Promise<void> {
    const provider = getWsProvider();
    provider.removeAllListeners();
    this.contracts.clear();
    console.log('[chainlink] Stopped');
  }
}
