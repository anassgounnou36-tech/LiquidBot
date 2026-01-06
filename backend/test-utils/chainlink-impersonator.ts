/**
 * ChainlinkImpersonator: Test utility for simulating Chainlink price feed updates
 * 
 * Allows impersonation of Chainlink aggregator transmitters on a forked network
 * to emit NewTransmission events for testing oracle-of-record confirmation flow.
 */

import { ethers } from 'ethers';

/**
 * Minimal OCR2Aggregator ABI for NewTransmission event emission
 */
const OCR2_AGGREGATOR_ABI = [
  'event NewTransmission(uint32 indexed aggregatorRoundId, int192 answer, address transmitter, int192[] observations, bytes observers, bytes32 rawReportContext)',
  'function transmit(bytes calldata report, bytes32[] calldata rs, bytes32[] calldata ss, bytes32 rawVs) external',
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)'
];

export interface ChainlinkFeedInfo {
  address: string;
  symbol: string;
  decimals: number;
  latestPrice?: bigint;
}

export class ChainlinkImpersonator {
  private provider: ethers.JsonRpcProvider;
  private feeds: Map<string, ChainlinkFeedInfo> = new Map();

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Register a Chainlink feed for impersonation
   * Fetches current decimals and latest price from the feed
   */
  async registerFeed(symbol: string, feedAddress: string): Promise<void> {
    const feed = new ethers.Contract(feedAddress, OCR2_AGGREGATOR_ABI, this.provider);

    try {
      const decimals = await feed.decimals();
      
      let latestPrice: bigint | undefined;
      try {
        const roundData = await feed.latestRoundData();
        latestPrice = roundData.answer;
      } catch {
        // Some feeds may not have latestRoundData yet on fresh fork
        latestPrice = undefined;
      }

      const feedInfo: ChainlinkFeedInfo = {
        address: feedAddress,
        symbol,
        decimals: Number(decimals),
        latestPrice
      };

      this.feeds.set(symbol, feedInfo);
      console.log(
        `[chainlink-impersonator] Registered ${symbol} feed at ${feedAddress} (decimals: ${decimals})`
      );
    } catch (error) {
      throw new Error(
        `Failed to register feed ${symbol} at ${feedAddress}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Note: Direct NewTransmission emission requires complex OCR2 signatures
   * 
   * For testing purposes, use one of these alternatives:
   * 1. Mine blocks to trigger natural Aave oracle updates
   * 2. Update Aave oracle price directly (if supported by fork)
   * 3. Use backend's price-trigger polling to detect changes
   * 
   * This method mines blocks as a simple trigger mechanism.
   * 
   * @param symbol Asset symbol (must be registered)
   * @param newPrice New price (logged for reference, not directly applied)
   * @param blockCount Number of blocks to mine (default: 5)
   */
  async triggerPriceUpdate(symbol: string, newPrice: number, blockCount = 5): Promise<void> {
    const feedInfo = this.feeds.get(symbol);
    if (!feedInfo) {
      throw new Error(`Feed not registered for symbol: ${symbol}`);
    }

    console.log(
      `[chainlink-impersonator] Triggering price update for ${symbol}: $${newPrice.toFixed(2)}`
    );
    console.log(
      `[chainlink-impersonator] Mining ${blockCount} blocks to trigger oracle/reserve updates...`
    );

    await this.mineBlocks(blockCount);

    console.log(
      `[chainlink-impersonator] ✓ Blocks mined. Backend should detect updates via:`
    );
    console.log(`  • Aave ReserveDataUpdated events`);
    console.log(`  • Price-trigger polling (if enabled)`);
    console.log(`  • Reserve index changes`);
  }

  /**
   * Mine a block to advance the fork
   */
  async mineBlock(): Promise<void> {
    await this.provider.send('anvil_mine', ['0x1']);
    console.log('[chainlink-impersonator] Mined 1 block');
  }

  /**
   * Mine multiple blocks
   */
  async mineBlocks(count: number): Promise<void> {
    await this.provider.send('anvil_mine', [ethers.toQuantity(count)]);
    console.log(`[chainlink-impersonator] Mined ${count} blocks`);
  }

  /**
   * Get feed info
   */
  getFeedInfo(symbol: string): ChainlinkFeedInfo | undefined {
    return this.feeds.get(symbol);
  }

  /**
   * Get all registered feeds
   */
  getAllFeeds(): ChainlinkFeedInfo[] {
    return Array.from(this.feeds.values());
  }
}

/**
 * Discover Chainlink feed address for a given symbol from backend logs
 * This parses backend startup logs to find the discovered feed addresses
 * 
 * @param logs Backend log output
 * @param symbol Asset symbol (e.g., 'WETH')
 * @returns Feed address or undefined
 */
export function extractFeedAddressFromLogs(logs: string, symbol: string): string | undefined {
  // Look for patterns like:
  // "[chainlink-feeds] Discovered feed for WETH: 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"
  // or similar feed discovery messages
  
  const patterns = [
    new RegExp(`feed for ${symbol}[:\\s]+0x[a-fA-F0-9]{40}`, 'i'),
    new RegExp(`${symbol}[:\\s]+0x[a-fA-F0-9]{40}`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = logs.match(pattern);
    if (match) {
      const addressMatch = match[0].match(/0x[a-fA-F0-9]{40}/);
      if (addressMatch) {
        return addressMatch[0];
      }
    }
  }
  
  return undefined;
}
