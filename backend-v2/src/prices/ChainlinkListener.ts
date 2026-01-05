// prices/ChainlinkListener.ts: Chainlink OCR2 price feed listener
// STRICT: Subscribe ONLY to OCR2 NewTransmission events, NOT AnswerUpdated (prevents duplicate triggers)

import { Contract, EventLog, Interface } from 'ethers';
import { getWsProvider } from '../providers/ws.js';

// Chainlink OCR2 Aggregator ABI (NewTransmission only)
const CHAINLINK_AGG_ABI = [
  'event NewTransmission(uint32 indexed aggregatorRoundId, int192 answer, address transmitter, int192[] observations, bytes observers, bytes32 rawReportContext)'
];

// Chainlink AggregatorV3 ABI (for reading latest price at startup)
const AGG_V3_ABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)'
];

export interface ChainlinkPriceUpdate {
  symbol: string;
  feedAddress: string;
  answer: bigint; // Normalized to 1e18
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
  private decimalsCache: Map<string, number> = new Map(); // feedAddress -> decimals
  private latestPrice1e18: Map<string, bigint> = new Map(); // feedAddress -> normalized price

  /**
   * Add a price feed to monitor
   * @param symbol Asset symbol (e.g., "WETH", "USDC")
   * @param feedAddress Chainlink feed contract address
   */
  async addFeed(symbol: string, feedAddress: string): Promise<void> {
    const normalizedAddress = feedAddress.toLowerCase();
    this.feeds.set(symbol, normalizedAddress);
    
    // Query and cache decimals for this feed, then seed initial price
    try {
      const provider = getWsProvider();
      const feedContract = new Contract(
        feedAddress,
        AGG_V3_ABI,
        provider
      );
      
      // Fetch decimals (ethers v6 returns BigInt, convert to number for arithmetic)
      const decimalsRaw = await feedContract.decimals();
      const decimals = Number(decimalsRaw);
      this.decimalsCache.set(normalizedAddress, decimals);
      
      // Fetch latest price to seed cache
      const [, answer] = await feedContract.latestRoundData();
      const rawAnswer = BigInt(answer.toString());
      
      // Sanity check: Chainlink prices should never be <= 0
      if (rawAnswer <= 0n) {
        console.warn(`[chainlink] Invalid price for ${symbol} (${feedAddress}): ${rawAnswer.toString()}. Skipping cache seed.`);
        return;
      }
      
      // Normalize answer to 1e18 BigInt using cached decimals
      let normalizedAnswer: bigint;
      if (decimals === 18) {
        normalizedAnswer = rawAnswer;
      } else if (decimals < 18) {
        normalizedAnswer = rawAnswer * (10n ** BigInt(18 - decimals));
      } else {
        normalizedAnswer = rawAnswer / (10n ** BigInt(decimals - 18));
      }
      
      // Store in cache (same map used by getCachedPrice)
      this.latestPrice1e18.set(normalizedAddress, normalizedAnswer);
      
      console.log(`[chainlink] Warmed feed: ${symbol} -> ${feedAddress} price=${normalizedAnswer.toString()} (1e18, decimals=${decimals})`);
    } catch (err) {
      console.error(`[chainlink] Failed to warm feed ${symbol} (${feedAddress}):`, err);
      // Do NOT throw - continue startup and allow RPC fallback or OCR2 events to populate cache later
    }
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
      const rawAnswer = BigInt(decoded.args.answer);

      // Dedupe by roundId:feedAddress
      const dedupeKey = `${roundId}:${feedAddress}`;
      if (this.dedupeCache.has(dedupeKey)) {
        return;
      }
      this.dedupeCache.add(dedupeKey);

      // Get cached decimals for normalization
      const decimals = this.decimalsCache.get(feedAddress);
      if (decimals === undefined) {
        console.error(`[chainlink] No cached decimals for feed ${feedAddress}`);
        return;
      }

      // Normalize answer to 1e18 BigInt using cached decimals
      let normalizedAnswer: bigint;
      if (decimals === 18) {
        normalizedAnswer = rawAnswer;
      } else if (decimals < 18) {
        const exponent = 18 - decimals;
        normalizedAnswer = rawAnswer * (10n ** BigInt(exponent));
      } else {
        const exponent = decimals - 18;
        normalizedAnswer = rawAnswer / (10n ** BigInt(exponent));
      }

      // Update in-memory price cache
      this.latestPrice1e18.set(feedAddress, normalizedAnswer);

      // Notify callbacks with normalized answer
      const update: ChainlinkPriceUpdate = {
        symbol,
        feedAddress,
        answer: normalizedAnswer,
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
        `[chainlink] NewTransmission: ${symbol} roundId=${roundId} rawAnswer=${rawAnswer.toString()} (${decimals}d) normalized=${normalizedAnswer.toString()} (1e18)`
      );
    } catch (err) {
      console.error('[chainlink] Error parsing log:', err);
    }
  }

  /**
   * Get cached price for a feed address (returns null if not cached)
   * This enables zero-RPC price lookups during planner execution
   */
  getCachedPrice(feedAddress: string): bigint | null {
    const normalizedAddress = feedAddress.toLowerCase();
    return this.latestPrice1e18.get(normalizedAddress) || null;
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
