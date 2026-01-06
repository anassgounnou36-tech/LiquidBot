// prices/PythListener.ts: Pyth Network price feed listener
// Ported from old bot - patterns preserved

import WebSocket from 'ws';
import { config } from '../config/index.js';

// Pyth price feed IDs for common assets (DO NOT hardcode per requirements - support env overrides)
const DEFAULT_PYTH_FEED_IDS: Record<string, string> = {
  'WETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'WBTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
};

export interface PythPriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
  confidence?: number;
  publishTime: number;
}

type PriceUpdateCallback = (update: PythPriceUpdate) => void;

/**
 * PythListener: Subscribe to Pyth Network WebSocket for real-time price updates
 * Features: WebSocket subscription, staleness detection, auto-reconnect
 */
export class PythListener {
  private ws: WebSocket | null = null;
  private callbacks: PriceUpdateCallback[] = [];
  private wsUrl: string;
  private assets: string[];
  private staleSecs: number;
  private feedIds: Record<string, string>;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isConnected = false;
  private shouldReconnect = true;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastMessageTime = 0;
  
  // Price cache: symbol -> { price1e18: bigint, publishTime: number }
  private priceCache = new Map<string, { price1e18: bigint; publishTime: number }>();

  constructor() {
    this.wsUrl = config.PYTH_WS_URL;
    this.assets = config.PYTH_ASSETS;
    this.staleSecs = config.PYTH_STALE_SECS;
    
    // Use env overrides if provided, otherwise use defaults
    this.feedIds = config.PYTH_FEED_IDS_JSON || DEFAULT_PYTH_FEED_IDS;
    
    console.log(
      `[pyth-listener] Initialized: assets=${this.assets.join(',')}, staleSecs=${this.staleSecs}`
    );
  }

  /**
   * Start listening to Pyth price updates
   */
  async start(): Promise<void> {
    if (this.isConnected) {
      console.warn('[pyth-listener] Already connected');
      return;
    }

    this.shouldReconnect = true;
    await this.connect();
  }

  /**
   * Stop listening and disconnect
   */
  async stop(): Promise<void> {
    console.log('[pyth-listener] Stopping');
    this.shouldReconnect = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Register callback for price updates
   */
  onPriceUpdate(callback: PriceUpdateCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Connect to Pyth WebSocket
   */
  private async connect(): Promise<void> {
    try {
      console.log(`[pyth-listener] Connecting to ${this.wsUrl}`);
      
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('[pyth-listener] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        
        // Subscribe to price feeds
        this.subscribe();
        
        // Start heartbeat monitoring
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        console.error('[pyth-listener] WebSocket error:', error);
      });

      this.ws.on('close', () => {
        console.warn('[pyth-listener] Connection closed');
        this.isConnected = false;
        
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }

        // Attempt reconnect if enabled
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnect();
        }
      });
    } catch (error) {
      console.error('[pyth-listener] Connection error:', error);
      
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnect();
      }
    }
  }

  /**
   * Subscribe to configured price feeds (using Pyth Hermes format)
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Get feed IDs for configured assets
    const feedIds: string[] = [];
    for (const symbol of this.assets) {
      const feedId = this.feedIds[symbol.toUpperCase()];
      if (feedId) {
        feedIds.push(feedId);
      } else {
        console.warn(`[pyth-listener] No feed ID found for ${symbol}`);
      }
    }

    if (feedIds.length === 0) {
      console.warn('[pyth-listener] No valid feed IDs to subscribe to');
      return;
    }

    // Subscribe using Pyth's WebSocket protocol
    const subscribeMessage = {
      type: 'subscribe',
      ids: feedIds
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    console.log(`[pyth-listener] Subscribed to ${feedIds.length} price feeds`);
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: WebSocket.RawData): void {
    this.lastMessageTime = Date.now();

    try {
      const message = JSON.parse(data.toString());

      // Handle price update messages
      if (message.type === 'price_update') {
        this.processPriceUpdate(message);
      }
    } catch (error) {
      console.error('[pyth-listener] Error parsing message:', error);
    }
  }

  /**
   * Process a price update from Pyth (with expo conversion)
   */
  private processPriceUpdate(message: Record<string, unknown>): void {
    try {
      const priceData = message.price_feed as Record<string, unknown> | undefined;
      if (!priceData) {
        return;
      }

      const feedId = priceData.id as string;
      const price = priceData.price as Record<string, unknown> | undefined;
      const publishTime = (priceData.publish_time as number) || Math.floor(Date.now() / 1000);

      if (!price || !(price.price)) {
        return;
      }

      // Find symbol for this feed ID
      const symbolEntry = Object.entries(this.feedIds).find(
        ([, id]) => id === feedId
      );
      const symbol = symbolEntry?.[0];

      if (!symbol) {
        return;
      }

      // Parse price (Pyth uses exponent notation - expo conversion)
      const priceValue = Number(price.price) * Math.pow(10, Number(price.expo));
      const confidence = price.conf ? Number(price.conf) * Math.pow(10, Number(price.expo)) : undefined;

      // Convert to 1e18-scaled BigInt for cache
      // Note: Math.floor precision is acceptable for USD prices at 1e18 scale
      // Pyth prices already have sufficient precision from expo conversion
      const price1e18 = BigInt(Math.floor(priceValue * 1e18));

      // Update price cache
      this.priceCache.set(symbol.toUpperCase(), { price1e18, publishTime });

      // Check staleness
      const now = Math.floor(Date.now() / 1000);
      const ageSec = now - publishTime;
      const isStale = ageSec > this.staleSecs;

      if (isStale) {
        console.warn(
          `[pyth-listener] STALE price for ${symbol}: age=${ageSec}s (threshold=${this.staleSecs}s)`
        );
      }

      // Create update object
      const update: PythPriceUpdate = {
        symbol,
        price: priceValue,
        timestamp: now,
        confidence,
        publishTime
      };

      // Notify callbacks
      this.notifyCallbacks(update);

      console.log(
        `[pyth-listener] Price update: ${symbol}=$${priceValue.toFixed(2)} (age: ${ageSec.toFixed(1)}s${isStale ? ' STALE' : ''})`
      );
    } catch (error) {
      console.error('[pyth-listener] Error processing price update:', error);
    }
  }

  /**
   * Notify all registered callbacks
   */
  private notifyCallbacks(update: PythPriceUpdate): void {
    for (const callback of this.callbacks) {
      try {
        callback(update);
      } catch (error) {
        console.error('[pyth-listener] Error in callback:', error);
      }
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Check for message timeout every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageTime;

      // If no message in 2 minutes, reconnect
      if (timeSinceLastMessage > 120000) {
        console.warn(
          `[pyth-listener] No messages received for ${Math.floor(timeSinceLastMessage / 1000)}s, reconnecting`
        );
        this.ws?.close();
      }
    }, 30000);
  }

  /**
   * Attempt reconnection
   */
  private reconnect(): void {
    this.reconnectAttempts++;
    
    console.log(
      `[pyth-listener] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    // Exponential backoff
    const delay = 5000 * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, Math.min(delay, 60000)); // Max 1 minute delay
  }

  /**
   * Get cached price as 1e18-scaled BigInt
   * Returns null if not cached
   * @param symbol Asset symbol (e.g., "WETH", "USDC")
   */
  getPrice1e18(symbol: string): bigint | null {
    const cached = this.priceCache.get(symbol.toUpperCase());
    return cached ? cached.price1e18 : null;
  }

  /**
   * Check if cached price is fresh (within staleness threshold)
   * @param symbol Asset symbol
   */
  isFresh(symbol: string): boolean {
    const cached = this.priceCache.get(symbol.toUpperCase());
    if (!cached) {
      return false;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const ageSec = now - cached.publishTime;
    return ageSec <= this.staleSecs;
  }

  /**
   * Get last update timestamp (Unix epoch seconds)
   * Returns 0 if not cached
   * @param symbol Asset symbol
   */
  getLastUpdateTs(symbol: string): number {
    const cached = this.priceCache.get(symbol.toUpperCase());
    return cached ? cached.publishTime : 0;
  }
}
