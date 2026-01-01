// providers/rpc.ts: HTTP JSON-RPC provider for Base

import { JsonRpcProvider } from 'ethers';
import { config } from '../config/index.js';

let httpProvider: JsonRpcProvider | null = null;

/**
 * Get or create the HTTP JSON-RPC provider
 */
export function getHttpProvider(): JsonRpcProvider {
  if (!httpProvider) {
    httpProvider = new JsonRpcProvider(config.RPC_URL);
    console.log('[rpc] HTTP provider initialized');
  }
  return httpProvider;
}

/**
 * Destroy the HTTP provider (for cleanup)
 */
export async function destroyHttpProvider(): Promise<void> {
  if (httpProvider) {
    // JsonRpcProvider doesn't have explicit cleanup, just null it
    httpProvider = null;
    console.log('[rpc] HTTP provider destroyed');
  }
}
