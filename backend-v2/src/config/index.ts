// config/index.ts: Export validated config

import { parseEnv, type Env } from './env.js';

// Parse env once on module load
export const config: Env = parseEnv();

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
