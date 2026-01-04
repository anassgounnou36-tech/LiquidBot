// config/env.ts: Strict environment variable validation using zod
// PR1: Minimal v2 config - NO feature flags explosion

import { z } from 'zod';

// Helper for parsing comma-separated lists
const commaSeparatedString = z
  .string()
  .transform((val) => val.split(',').map((s) => s.trim()).filter((s) => s.length > 0));

// Helper for parsing JSON strings with fallback
const optionalJsonString = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      try {
        return schema.parse(JSON.parse(val));
      } catch {
        return undefined;
      }
    });

// Strict env schema - ONLY what's needed for PR1
const envSchema = z.object({
  // RPC endpoints
  RPC_URL: z.string().url(),
  WS_RPC_URL: z.string().url(),
  
  // Multi-RPC broadcasting (optional, comma-separated list)
  BROADCAST_RPC_URLS: commaSeparatedString.optional(),

  // Subgraph
  SUBGRAPH_URL: z.string().url(),
  GRAPH_API_KEY: z.string().optional(),

  // Aave V3 Pool
  AAVE_POOL_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  AAVE_PROTOCOL_DATA_PROVIDER: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  // Aave base currency configuration
  AAVE_BASE_CURRENCY_DECIMALS: z.coerce.number().min(0).max(18).default(8),
  AAVE_BASE_CURRENCY_IS_USD: z.string().transform(val => val === 'true').default('false'),

  // Risk thresholds
  MIN_DEBT_USD: z.coerce.number().min(0).default(50.0),
  HF_THRESHOLD_START: z.coerce.number().min(1.0).default(1.05),
  HF_THRESHOLD_EXECUTE: z.coerce.number().min(0.9).max(1.0).default(1.0),

  // Executor (reserved for PR2)
  EXECUTOR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  EXECUTION_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),

  // 1inch API (optional for PR2)
  ONEINCH_API_KEY: z.string().optional(),

  // Execution control
  EXECUTION_ENABLED: z.string().transform(val => val === 'true').default('false'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // Chainlink feeds (optional overrides)
  CHAINLINK_FEEDS_JSON: optionalJsonString(z.record(z.string(), z.string())),
  CHAINLINK_FEEDS_BY_ADDRESS_JSON: optionalJsonString(z.record(z.string(), z.string())),

  // Pyth Network
  PYTH_WS_URL: z.string().url().default('wss://hermes.pyth.network/ws'),
  PYTH_ASSETS: commaSeparatedString.default('WETH,USDC,WBTC'),
  PYTH_STALE_SECS: z.coerce.number().min(10).default(60),
  PYTH_FEED_IDS_JSON: optionalJsonString(z.record(z.string(), z.string())),

  // Price cache configuration
  PRICE_CACHE_TTL_MS: z.coerce.number().min(1000).max(60000).default(8000),

  // Universe seeding configuration
  UNIVERSE_MAX_CANDIDATES: z.coerce.number().min(100).optional(),

  // Watched set configuration
  WATCH_HF_MAX: z.coerce.number().min(1.0).optional(),

  // Block heartbeat configuration
  LOG_BLOCK_HEARTBEAT: z.string().transform(val => val === 'true').default('false'),
  BLOCK_HEARTBEAT_EVERY_N: z.coerce.number().min(1).default(1),

  // Live event trace configuration
  LOG_LIVE_EVENTS: z.string().transform(val => val === 'true').default('false'),
  LOG_LIVE_EVENTS_ONLY_WATCHED: z.string().transform(val => val === 'true').default('true'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Throws on validation failure with clear error messages.
 */
export function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('[config] Environment validation failed:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    throw new Error('Invalid environment configuration');
  }
  
  return result.data;
}
