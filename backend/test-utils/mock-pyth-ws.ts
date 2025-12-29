/**
 * MockPythServer: Test utility for Pyth WebSocket simulation
 * 
 * Provides a lightweight WebSocket server that mimics Pyth Hermes API
 * for end-to-end predictive pipeline testing. Accepts subscriptions and
 * allows programmatic price update injection.
 * 
 * Message Format (matching PythListener expectations):
 * - Subscribe request: { type: 'subscribe', ids: ['0x...'] }
 * - Price update: { type: 'price_update', price_feed: { id, price: { price, conf, expo }, publish_time } }
 */

import WebSocket, { WebSocketServer } from 'ws';

interface PriceData {
  price: string | number;
  conf: string | number;
  expo: number;
}

interface PriceFeed {
  id: string;
  price: PriceData;
  publish_time: number;
}

interface PriceUpdateMessage {
  type: 'price_update';
  price_feed: PriceFeed;
}

interface SubscribeMessage {
  type: 'subscribe';
  ids: string[];
}

/**
 * Pyth price feed IDs (must match PythListener constants)
 */
export const PYTH_FEED_IDS = {
  WETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  WBTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  cbETH: '0x15ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce5717', // cbETH/USD
  cbBTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // Uses BTC/USD as proxy
  AAVE: '0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445',
};

export class MockPythServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private subscribedFeeds: Set<string> = new Set();
  private port: number;
  private host: string;

  constructor(port = 8999, host = '127.0.0.1') {
    this.port = port;
    this.host = host;
  }

  /**
   * Start the mock WebSocket server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ 
          host: this.host,
          port: this.port 
        });

        this.wss.on('connection', (ws: WebSocket) => {
          console.log('[mock-pyth] Client connected');
          this.clients.add(ws);

          ws.on('message', (data: Buffer) => {
            this.handleMessage(ws, data);
          });

          ws.on('close', () => {
            console.log('[mock-pyth] Client disconnected');
            this.clients.delete(ws);
          });

          ws.on('error', (error) => {
            console.error('[mock-pyth] WebSocket error:', error);
          });
        });

        this.wss.on('listening', () => {
          console.log(`[mock-pyth] Server listening on ws://${this.host}:${this.port}`);
          resolve();
        });

        this.wss.on('error', (error) => {
          console.error('[mock-pyth] Server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the mock WebSocket server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all client connections
      for (const client of this.clients) {
        try {
          client.close();
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
      this.clients.clear();

      // Close the server
      if (this.wss) {
        this.wss.close(() => {
          console.log('[mock-pyth] Server stopped');
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming client messages
   */
  private handleMessage(ws: WebSocket, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as SubscribeMessage;

      if (message.type === 'subscribe' && Array.isArray(message.ids)) {
        console.log(`[mock-pyth] Subscription request for ${message.ids.length} feed(s)`);
        
        // Track subscribed feeds
        for (const id of message.ids) {
          this.subscribedFeeds.add(id);
        }

        // Send confirmation (optional, Hermes may not send this)
        ws.send(JSON.stringify({
          type: 'subscribed',
          ids: message.ids
        }));
      }
    } catch (error) {
      console.error('[mock-pyth] Error handling message:', error);
    }
  }

  /**
   * Send a price update to all connected clients
   * 
   * @param symbol Asset symbol (e.g., 'WETH')
   * @param price Price value in USD (will be converted to Pyth format)
   * @param confidence Confidence interval (optional, defaults to 0.01% of price)
   * @param publishTime Unix timestamp in seconds (optional, defaults to now)
   */
  public sendPriceUpdate(
    symbol: string,
    price: number,
    confidence?: number,
    publishTime?: number
  ): void {
    const feedId = PYTH_FEED_IDS[symbol as keyof typeof PYTH_FEED_IDS];
    if (!feedId) {
      throw new Error(`Unknown symbol: ${symbol}. Valid symbols: ${Object.keys(PYTH_FEED_IDS).join(', ')}`);
    }

    // Check if anyone is subscribed to this feed
    if (!this.subscribedFeeds.has(feedId)) {
      console.warn(`[mock-pyth] No subscriptions for ${symbol} (${feedId})`);
    }

    // Pyth uses exponent notation (e.g., price=3000, expo=-8 means $3000)
    // We'll use expo=-8 to represent prices in dollars with 8 decimal precision
    const expo = -8;
    const priceInt = Math.floor(price * Math.pow(10, -expo));
    const confInt = confidence 
      ? Math.floor(confidence * Math.pow(10, -expo))
      : Math.floor(priceInt * 0.0001); // 0.01% default confidence

    const update: PriceUpdateMessage = {
      type: 'price_update',
      price_feed: {
        id: feedId,
        price: {
          price: priceInt.toString(),
          conf: confInt.toString(),
          expo: expo
        },
        publish_time: publishTime || Math.floor(Date.now() / 1000)
      }
    };

    const message = JSON.stringify(update);
    let sentCount = 0;

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        sentCount++;
      }
    }

    console.log(
      `[mock-pyth] Sent ${symbol} price update: $${price.toFixed(2)} to ${sentCount} client(s)`
    );
  }

  /**
   * Get the WebSocket URL for this server
   */
  public getUrl(): string {
    return `ws://${this.host}:${this.port}`;
  }

  /**
   * Get number of connected clients
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get subscribed feed IDs
   */
  public getSubscribedFeeds(): string[] {
    return Array.from(this.subscribedFeeds);
  }
}

/**
 * Helper to calculate new price based on percentage change
 */
export function calculateNewPrice(basePrice: number, deltaPct: number): number {
  return basePrice * (1 + deltaPct / 100);
}
