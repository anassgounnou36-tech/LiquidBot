// providers/ws.ts: WebSocket provider for Base with reconnect guards

import { WebSocketProvider } from 'ethers';
import { config } from '../config/index.js';

let wsProvider: WebSocketProvider | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let isReconnecting = false;

/**
 * Get or create the WebSocket provider with basic heartbeat/reconnect guards
 */
export function getWsProvider(): WebSocketProvider {
  if (!wsProvider) {
    wsProvider = createWsProvider();
  }
  return wsProvider;
}

/**
 * Create a new WebSocket provider with error handling
 */
function createWsProvider(): WebSocketProvider {
  const provider = new WebSocketProvider(config.WS_RPC_URL);
  
  // Add error handler
  // Note: ethers v6 WebSocketProvider only supports standard ProviderEvents
  // ('block', 'error', etc.). The 'close' event is NOT supported and will crash.
  // Error handling is sufficient as ethers manages WebSocket lifecycle internally.
  provider.on('error', (error: Error) => {
    console.error('[ws] Provider error:', error.message);
    handleDisconnect();
  });
  
  console.log('[ws] WebSocket provider initialized');
  reconnectAttempts = 0;
  
  return provider;
}

/**
 * Handle disconnect and attempt reconnect
 */
function handleDisconnect(): void {
  if (isReconnecting) return;
  
  reconnectAttempts++;
  
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error('[ws] Max reconnect attempts reached, giving up');
    return;
  }
  
  const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
  console.log(`[ws] Attempting reconnect in ${backoffMs}ms (attempt ${reconnectAttempts})`);
  
  isReconnecting = true;
  
  setTimeout(() => {
    isReconnecting = false;
    
    if (wsProvider) {
      wsProvider.removeAllListeners();
      wsProvider.destroy().catch(() => {
        // Ignore destroy errors
      });
    }
    
    wsProvider = createWsProvider();
  }, backoffMs);
}

/**
 * Destroy the WebSocket provider (for cleanup)
 */
export async function destroyWsProvider(): Promise<void> {
  if (wsProvider) {
    try {
      wsProvider.removeAllListeners();
      await wsProvider.destroy();
      wsProvider = null;
      console.log('[ws] WebSocket provider destroyed');
    } catch (err) {
      console.error('[ws] Error destroying provider:', err);
    }
  }
}
