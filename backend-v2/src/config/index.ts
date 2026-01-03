// config/index.ts: Export validated config

import { parseEnv, type Env } from './env.js';

/**
 * Validate that a string is a valid Ethereum address (0x + 40 hex chars)
 */
function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate Chainlink feed configurations
 * Ensures all feed addresses are valid 0x-prefixed addresses to avoid ENS resolution issues
 */
function validateChainlinkFeeds(config: Env): void {
  // Validate CHAINLINK_FEEDS_JSON (symbol -> feed address)
  if (config.CHAINLINK_FEEDS_JSON) {
    for (const [symbol, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_JSON)) {
      if (typeof feedAddress !== 'string' || !isValidEthereumAddress(feedAddress)) {
        throw new Error(
          `Invalid Chainlink feed address for ${symbol}: "${feedAddress}". ` +
          `Expected 0x-prefixed 40-character hex address. ` +
          `ENS names and other formats are not supported.`
        );
      }
    }
    console.log(`[config] ✓ Validated ${Object.keys(config.CHAINLINK_FEEDS_JSON).length} Chainlink feed addresses`);
  }
  
  // Validate CHAINLINK_FEEDS_BY_ADDRESS_JSON (token address -> feed address)
  if (config.CHAINLINK_FEEDS_BY_ADDRESS_JSON) {
    for (const [tokenAddress, feedAddress] of Object.entries(config.CHAINLINK_FEEDS_BY_ADDRESS_JSON)) {
      if (typeof tokenAddress !== 'string' || !isValidEthereumAddress(tokenAddress)) {
        throw new Error(
          `Invalid token address in CHAINLINK_FEEDS_BY_ADDRESS_JSON: "${tokenAddress}". ` +
          `Expected 0x-prefixed 40-character hex address.`
        );
      }
      if (typeof feedAddress !== 'string' || !isValidEthereumAddress(feedAddress)) {
        throw new Error(
          `Invalid feed address for token ${tokenAddress}: "${feedAddress}". ` +
          `Expected 0x-prefixed 40-character hex address. ` +
          `ENS names and other formats are not supported.`
        );
      }
    }
    console.log(`[config] ✓ Validated ${Object.keys(config.CHAINLINK_FEEDS_BY_ADDRESS_JSON).length} address-to-feed mappings`);
  }
  
  // Validate CHAINLINK_RATIO_FEEDS_BY_ADDRESS_JSON if present (same structure)
  // Note: This config key doesn't exist in env.ts yet, but we validate for future-proofing
  if ('CHAINLINK_RATIO_FEEDS_BY_ADDRESS_JSON' in config) {
    const ratioFeeds = (config as any).CHAINLINK_RATIO_FEEDS_BY_ADDRESS_JSON;
    if (ratioFeeds && typeof ratioFeeds === 'object') {
      for (const [tokenAddress, feedAddress] of Object.entries(ratioFeeds)) {
        if (typeof feedAddress !== 'string') continue;
        if (typeof tokenAddress !== 'string' || !isValidEthereumAddress(tokenAddress)) {
          throw new Error(
            `Invalid token address in CHAINLINK_RATIO_FEEDS_BY_ADDRESS_JSON: "${tokenAddress}". ` +
            `Expected 0x-prefixed 40-character hex address.`
          );
        }
        if (!isValidEthereumAddress(feedAddress)) {
          throw new Error(
            `Invalid feed address for token ${tokenAddress}: "${feedAddress}". ` +
            `Expected 0x-prefixed 40-character hex address. ` +
            `ENS names and other formats are not supported.`
          );
        }
      }
      console.log(`[config] ✓ Validated ratio feed mappings`);
    }
  }
}

// Parse env once on module load
export const config: Env = parseEnv();

// Validate Chainlink feed addresses (strict fail-fast)
validateChainlinkFeeds(config);

// Log redacted config on load (for startup diagnostics)
console.log('[config] Loaded configuration:', {
  rpcUrl: config.RPC_URL.replace(/\/\/.*@/, '//****@'), // Redact auth in URL
  wsRpcUrl: config.WS_RPC_URL.replace(/\/\/.*@/, '//****@'),
  subgraphUrl: config.SUBGRAPH_URL.replace(/\/api\/.*\/subgraphs/, '/api/****/subgraphs'),
  hasGraphApiKey: !!config.GRAPH_API_KEY,
  aavePool: config.AAVE_POOL_ADDRESS,
  minDebtUsd: config.MIN_DEBT_USD,
  hfThresholdStart: config.HF_THRESHOLD_START,
  hfThresholdExecute: config.HF_THRESHOLD_EXECUTE,
  hasTelegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
  pythAssets: config.PYTH_ASSETS,
  pythStaleSecs: config.PYTH_STALE_SECS,
});
