import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform(v => v === 'true');
const isTest = (process.env.NODE_ENV || '').toLowerCase() === 'test';

// Inject test defaults BEFORE schema parsing so Zod doesn't throw for test runs.
if (isTest) {
  if (!process.env.API_KEY) process.env.API_KEY = 'test-api-key';
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret';
  if (!process.env.USE_MOCK_SUBGRAPH) process.env.USE_MOCK_SUBGRAPH = 'true';
}

export const rawEnvSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),

  API_KEY: z.string().min(3, 'API_KEY required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET too short'),

  USE_MOCK_SUBGRAPH: z.string().optional().default('false'),
  GRAPH_API_KEY: z.string().optional(),
  SUBGRAPH_DEPLOYMENT_ID: z.string().optional(),

  SUBGRAPH_POLL_INTERVAL_MS: z.string().optional(),
  SUBGRAPH_DEBUG_ERRORS: z.string().optional(),

  LIQUIDATION_POLL_LIMIT: z.string().optional(),
  LIQUIDATION_TRACK_MAX: z.string().optional(),

  SUBGRAPH_FAILURE_THRESHOLD: z.string().optional(),
  SUBGRAPH_RETRY_ATTEMPTS: z.string().optional(),
  SUBGRAPH_RETRY_BASE_MS: z.string().optional(),
  SUBGRAPH_RATE_LIMIT_CAPACITY: z.string().optional(),
  SUBGRAPH_RATE_LIMIT_INTERVAL_MS: z.string().optional(),

  AAVE_POOL_ADDRESS: z.string().optional(),
  
  // Aave V3 Base Data Provider addresses
  AAVE_ADDRESSES_PROVIDER: z.string().optional(),
  AAVE_PROTOCOL_DATA_PROVIDER: z.string().optional(),
  AAVE_ORACLE: z.string().optional(),
  AAVE_POOL_CONFIGURATOR: z.string().optional(),
  AAVE_UI_POOL_DATA_PROVIDER: z.string().optional(),
  AAVE_WRAPPED_TOKEN_GATEWAY: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),

  REFINANCING_FEE_BPS: z.string().optional(),
  EMERGENCY_FEE_BPS: z.string().optional(),

  // Telegram notifications (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Health monitoring
  HEALTH_ALERT_THRESHOLD: z.string().optional(),
  HEALTH_EMERGENCY_THRESHOLD: z.string().optional(),

  // Profit estimation
  PROFIT_FEE_BPS: z.string().optional(),
  PROFIT_MIN_USD: z.string().optional(),

  // Price oracle
  PRICE_ORACLE_MODE: z.string().optional(),

  // Health factor resolver
  HEALTH_USER_CACHE_TTL_MS: z.string().optional(),
  HEALTH_MAX_BATCH: z.string().optional(),
  HEALTH_QUERY_MODE: z.string().optional(),

  // Poll configuration
  POLL_LIMIT: z.string().optional(),
  IGNORE_BOOTSTRAP_BATCH: z.string().optional(),

  // Gas cost estimation
  GAS_COST_USD: z.string().optional(),

  // Chainlink price feeds
  CHAINLINK_RPC_URL: z.string().optional(),
  CHAINLINK_FEEDS: z.string().optional(),
  PRICE_STALENESS_SEC: z.string().optional(),
  RATIO_PRICE_ENABLED: z.string().optional(),
  
  // Price feed aliases and derived assets
  PRICE_FEED_ALIASES: z.string().optional(),
  DERIVED_RATIO_FEEDS: z.string().optional(),
  PRICE_POLL_DISABLE_AFTER_ERRORS: z.string().optional(),
  
  // Price readiness and deferred valuation
  PRICE_DEFER_UNTIL_READY: z.string().optional(),
  PRICE_SYMBOL_ALIASES: z.string().optional(),

  // Price-triggered emergency scans
  PRICE_TRIGGER_ENABLED: z.string().optional(),
  PRICE_TRIGGER_DROP_BPS: z.string().optional(),
  PRICE_TRIGGER_MAX_SCAN: z.string().optional(),
  PRICE_TRIGGER_ASSETS: z.string().optional(),
  PRICE_TRIGGER_DEBOUNCE_SEC: z.string().optional(),
  PRICE_TRIGGER_CUMULATIVE: z.string().optional(),
  PRICE_TRIGGER_POLL_SEC: z.string().optional(),
  
  // Per-asset price trigger configuration
  PRICE_TRIGGER_BPS_BY_ASSET: z.string().optional(),
  PRICE_TRIGGER_DEBOUNCE_BY_ASSET: z.string().optional(),
  
  // Price trigger stablecoin filtering
  PRICE_TRIGGER_SKIP_STABLES: z.string().optional(),
  PRICE_TRIGGER_STABLECOIN_LIST: z.string().optional(),
  
  // Price trigger near-band gating
  PRICE_TRIGGER_NEAR_BAND_ONLY: z.string().optional(),
  PRICE_TRIGGER_NEAR_BAND_BPS: z.string().optional(),
  PRICE_TRIGGER_RESERVE_TOP_N: z.string().optional(),
  PRICE_TRIGGER_JITTER_MIN_MS: z.string().optional(),
  PRICE_TRIGGER_JITTER_MAX_MS: z.string().optional(),
  PRICE_TRIGGER_NEAR_BAND_LOWER_BOUND: z.string().optional(),
  PRICE_TRIGGER_MIN_INTERVAL_SEC: z.string().optional(),
  PRICE_TRIGGER_GLOBAL_RATE_LIMIT: z.string().optional(),
  
  // Auto-discovery of Chainlink feeds and debt tokens
  AUTO_DISCOVER_FEEDS: z.string().optional(),
  
  // Reserve-targeted recheck configuration
  RESERVE_RECHECK_TOP_N: z.string().optional(),
  RESERVE_RECHECK_MAX_BATCH: z.string().optional(),
  RESERVE_RECHECK_TOP_N_BY_ASSET: z.string().optional(),
  RESERVE_RECHECK_NEAR_BAND_ONLY: z.string().optional(),
  RESERVE_MIN_INDEX_DELTA_BPS: z.string().optional(),
  
  // Global RPC rate limiting
  GLOBAL_RPC_RATE_LIMIT: z.string().optional(),
  GLOBAL_RPC_BURST_CAPACITY: z.string().optional(),
  ETH_CALL_TRANSPORT: z.string().optional(),
  ETH_CALL_MAX_IN_FLIGHT: z.string().optional(),
  
  // Pending-state verification
  PENDING_VERIFY_ENABLED: z.string().optional(),
  
  // BorrowersIndex configuration
  BORROWERS_INDEX_ENABLED: z.string().optional(),
  BORROWERS_INDEX_MODE: z.string().optional(),
  BORROWERS_INDEX_REDIS_URL: z.string().optional(),
  BORROWERS_INDEX_MAX_USERS_PER_RESERVE: z.string().optional(),
  BORROWERS_INDEX_BACKFILL_BLOCKS: z.string().optional(),
  BORROWERS_INDEX_CHUNK_BLOCKS: z.string().optional(),
  
  // Startup diagnostics
  STARTUP_DIAGNOSTICS: z.string().optional(),
  STARTUP_DIAG_TIMEOUT_MS: z.string().optional(),
  
  // Mempool transmit monitoring
  TRANSMIT_MEMPOOL_ENABLED: z.string().optional(),
  MEMPOOL_SUBSCRIPTION_MODE: z.string().optional(),
  
  // Latency metrics
  LATENCY_METRICS_ENABLED: z.string().optional(),
  METRICS_EMIT_INTERVAL_BLOCKS: z.string().optional(),

  // At-risk user scanning
  AT_RISK_SCAN_LIMIT: z.string().optional(),
  AT_RISK_WARN_THRESHOLD: z.string().optional(),
  AT_RISK_LIQ_THRESHOLD: z.string().optional(),
  AT_RISK_DUST_EPSILON: z.string().optional(),
  AT_RISK_NOTIFY_WARN: z.string().optional(),
  AT_RISK_NOTIFY_CRITICAL: z.string().optional(),

  // Execution scaffold
  EXECUTION_ENABLED: z.string().optional(),
  DRY_RUN_EXECUTION: z.string().optional(),
  PRIVATE_BUNDLE_RPC: z.string().optional(),
  MAX_GAS_PRICE_GWEI: z.string().optional(),
  MIN_PROFIT_AFTER_GAS_USD: z.string().optional(),
  MAX_POSITION_SIZE_USD: z.string().optional(),
  DAILY_LOSS_LIMIT_USD: z.string().optional(),
  BLACKLISTED_TOKENS: z.string().optional(),

  // On-chain executor
  EXECUTOR_ADDRESS: z.string().optional(),
  EXECUTION_PRIVATE_KEY: z.string().optional(),
  RPC_URL: z.string().optional(),
  CHAIN_ID: z.string().optional(),
  ONEINCH_API_KEY: z.string().optional(),
  ONEINCH_BASE_URL: z.string().optional(),
  MAX_SLIPPAGE_BPS: z.string().optional(),
  CLOSE_FACTOR_MODE: z.string().optional(),
  CLOSE_FACTOR_EXECUTION_MODE: z.string().optional(),
  LIQUIDATION_DEBT_ASSETS: z.string().optional(),
  MIN_REPAY_USD: z.string().optional(),
  MAX_TARGET_USERS_PER_TICK: z.string().optional(),

  // Real-time HF detection
  USE_REALTIME_HF: z.string().optional(),
  WS_RPC_URL: z.string().optional(),
  USE_FLASHBLOCKS: z.string().optional(),
  FLASHBLOCKS_WS_URL: z.string().optional(),
  FLASHBLOCKS_TICK_MS: z.string().optional(),
  MULTICALL3_ADDRESS: z.string().optional(),
  AAVE_POOL: z.string().optional(),
  EXECUTION_HF_THRESHOLD_BPS: z.string().optional(),
  REALTIME_SEED_INTERVAL_SEC: z.string().optional(),
  CANDIDATE_MAX: z.string().optional(),
  HYSTERESIS_BPS: z.string().optional(),
  NOTIFY_ONLY_WHEN_ACTIONABLE: z.string().optional(),
  EXECUTION_INFLIGHT_LOCK: z.string().optional(),

  // Subgraph usage gating
  USE_SUBGRAPH: z.string().optional(),

  // Subgraph refresh interval for candidate discovery (minutes)
  SUBGRAPH_REFRESH_MINUTES: z.string().optional(),

  // On-chain backfill for candidate discovery
  REALTIME_INITIAL_BACKFILL_ENABLED: z.string().optional(),
  REALTIME_INITIAL_BACKFILL_BLOCKS: z.string().optional(),
  REALTIME_INITIAL_BACKFILL_CHUNK_BLOCKS: z.string().optional(),
  REALTIME_INITIAL_BACKFILL_MAX_LOGS: z.string().optional(),
  BACKFILL_RPC_URL: z.string().optional(),

  // Subgraph paging (when USE_SUBGRAPH=true)
  SUBGRAPH_PAGE_SIZE: z.string().optional(),

  // Head-check paging/rotation
  HEAD_CHECK_PAGE_STRATEGY: z.string().optional(),
  HEAD_CHECK_PAGE_SIZE: z.string().optional(),

  // Always-include low-HF threshold for head checks
  ALWAYS_INCLUDE_HF_BELOW: z.string().optional(),

  // Optional secondary RPC for head-check fallback
  SECONDARY_HEAD_RPC_URL: z.string().optional(),

  // Optional hedge window for dirty-first chunks (milliseconds)
  HEAD_CHECK_HEDGE_MS: z.string().optional(),

  // Timeout and retry configuration for multicall chunks
  CHUNK_TIMEOUT_MS: z.string().optional(),
  CHUNK_RETRY_ATTEMPTS: z.string().optional(),

  // Run-level watchdog configuration
  RUN_STALL_ABORT_MS: z.string().optional(),

  // WebSocket heartbeat configuration
  WS_HEARTBEAT_MS: z.string().optional(),

  // Multicall batch size configuration
  MULTICALL_BATCH_SIZE: z.string().optional(),

  // Adaptive head page sizing
  HEAD_PAGE_ADAPTIVE: z.string().optional(),
  HEAD_PAGE_TARGET_MS: z.string().optional(),
  HEAD_PAGE_MIN: z.string().optional(),
  HEAD_PAGE_MAX: z.string().optional(),

  // Event batch coalescing and limits
  EVENT_BATCH_COALESCE_MS: z.string().optional(),
  EVENT_BATCH_MAX_PER_BLOCK: z.string().optional(),
  MAX_PARALLEL_EVENT_BATCHES: z.string().optional(),
  
  // Adaptive event concurrency
  ADAPTIVE_EVENT_CONCURRENCY: z.string().optional(),
  MAX_PARALLEL_EVENT_BATCHES_HIGH: z.string().optional(),
  EVENT_BACKLOG_THRESHOLD: z.string().optional(),
  
  // Dust threshold configuration
  DUST_MIN_USD: z.string().optional(),
  MIN_DEBT_USD: z.string().optional(),

  // ==== Phase 1 Performance Enhancements ====
  // Mempool transmit monitoring
  MEMPOOL_MONITOR_ENABLED: z.string().optional(),
  
  // Health factor projection
  HF_PROJECTION_ENABLED: z.string().optional(),
  HF_PROJECTION_CRITICAL_MIN: z.string().optional(),
  HF_PROJECTION_CRITICAL_MAX: z.string().optional(),
  HF_PROJECTION_BLOCKS: z.string().optional(),
  
  // Reserve event coalescing
  RESERVE_COALESCE_ENABLED: z.string().optional(),
  RESERVE_COALESCE_WINDOW_MS: z.string().optional(),
  RESERVE_COALESCE_MAX_BATCH: z.string().optional(),
  RESERVE_COALESCE_PER_RESERVE: z.string().optional(),
  
  // Performance metrics
  PERF_METRICS_ENABLED: z.string().optional(),
  PERF_METRICS_LOG_INTERVAL_MS: z.string().optional(),
  PERF_METRICS_WINDOW_MS: z.string().optional(),
  
  // Vectorized HF calculator
  VECTORIZED_HF_ENABLED: z.string().optional(),
  VECTORIZED_HF_CACHE_TTL_MS: z.string().optional(),
  VECTORIZED_HF_MAX_TTL_MS: z.string().optional(),
  VECTORIZED_HF_MIN_TTL_MS: z.string().optional(),

  // Low HF Tracker for observability
  LOW_HF_TRACKER_ENABLED: z.string().optional(),
  LOW_HF_TRACKER_MAX: z.string().optional(),
  LOW_HF_RECORD_MODE: z.string().optional(),
  LOW_HF_DUMP_ON_SHUTDOWN: z.string().optional(),
  LOW_HF_SUMMARY_INTERVAL_SEC: z.string().optional(),
  LOW_HF_EXTENDED_ENABLED: z.string().optional(),

  // Liquidation close factor configuration
  LIQUIDATION_CLOSE_FACTOR: z.string().optional(),

  // Liquidation audit configuration
  LIQUIDATION_AUDIT_ENABLED: z.string().optional(),
  LIQUIDATION_AUDIT_NOTIFY: z.string().optional(),
  LIQUIDATION_AUDIT_PRICE_MODE: z.string().optional(),
  LIQUIDATION_AUDIT_SAMPLE_LIMIT: z.string().optional(),
  
  // Decision trace and classifier (defaults to true when LIQUIDATION_AUDIT_ENABLED=true)
  DECISION_TRACE_ENABLED: z.string().optional(),
  AUDIT_CLASSIFIER_ENABLED: z.string().optional(),
  
  // Liquidation Miss Classifier configuration
  MISS_CLASSIFIER_ENABLED: z.string().optional(),
  MISS_TRANSIENT_BLOCKS: z.string().optional(),
  MISS_MIN_PROFIT_USD: z.string().optional(),
  MISS_GAS_THRESHOLD_GWEI: z.string().optional(),
  MISS_ENABLE_PROFIT_CHECK: z.string().optional(),
  
  // Prices via Aave Oracle
  PRICES_USE_AAVE_ORACLE: z.string().optional(),
  
  // Hot/Warm/Cold set tracking (aka Hotlist)
  HOT_SET_ENABLED: z.string().optional(),
  HOTLIST_ENABLED: z.string().optional(), // Alias for HOT_SET_ENABLED
  HOT_SET_HF_MAX: z.string().optional(),
  HOTLIST_MIN_HF: z.string().optional(), // Min HF for hotlist inclusion (default: 0.99)
  HOTLIST_MAX_HF: z.string().optional(), // Max HF for hotlist inclusion (default: 1.03)
  HOTLIST_MIN_DEBT_USD: z.string().optional(), // Min debt USD for hotlist inclusion (default: 5)
  HOTLIST_MAX: z.string().optional(), // Max hotlist size (default: 2000)
  HOTLIST_REVISIT_SEC: z.string().optional(), // Hotlist refresh interval in seconds (default: 5)
  WARM_SET_HF_MAX: z.string().optional(),
  MAX_HOT_SIZE: z.string().optional(),
  MAX_WARM_SIZE: z.string().optional(),
  
  // Precompute configuration
  PRECOMPUTE_ENABLED: z.string().optional(),
  PRECOMPUTE_TOP_K: z.string().optional(),
  PRECOMPUTE_CLOSE_FACTOR_PCT: z.string().optional(),
  PRECOMPUTE_RECEIVE_A_TOKEN: z.string().optional(), // Whether to receive aToken (default: false)
  
  // Price fastpath (Chainlink events)
  PRICE_FASTPATH_ENABLED: z.string().optional(),
  PRICE_FASTPATH_ASSETS: z.string().optional(),
  
  // Gas strategy
  GAS_STRATEGY: z.string().optional(),
  GAS_MAX_FEE_MULTIPLIER: z.string().optional(),
  GAS_MIN_PRIORITY_GWEI: z.string().optional(),
  USE_PRIVATE_TX: z.string().optional(),

  // Priority Sweep configuration
  PRIORITY_SWEEP_ENABLED: z.string().optional(),
  PRIORITY_SWEEP_INTERVAL_MIN: z.string().optional(),
  PRIORITY_MIN_DEBT_USD: z.string().optional(),
  PRIORITY_MIN_COLLATERAL_USD: z.string().optional(),
  PRIORITY_TARGET_SIZE: z.string().optional(),
  PRIORITY_MAX_SCAN_USERS: z.string().optional(),
  PRIORITY_SCORE_DEBT_WEIGHT: z.string().optional(),
  PRIORITY_SCORE_COLLATERAL_WEIGHT: z.string().optional(),
  PRIORITY_SCORE_HF_PENALTY: z.string().optional(),
  PRIORITY_SCORE_HF_CEILING: z.string().optional(),
  PRIORITY_SCORE_LOW_HF_BOOST: z.string().optional(),
  PRIORITY_SWEEP_LOG_SUMMARY: z.string().optional(),
  PRIORITY_SWEEP_METRICS_ENABLED: z.string().optional(),
  PRIORITY_SWEEP_TIMEOUT_MS: z.string().optional(),
  PRIORITY_SWEEP_PAGE_SIZE: z.string().optional(),
  PRIORITY_SWEEP_INTER_REQUEST_MS: z.string().optional(),
  
  // Execution Path Acceleration Configuration
  PRE_SIM_ENABLED: z.string().optional(),
  PRE_SIM_HF_WINDOW: z.string().optional(),
  PRE_SIM_MIN_DEBT_USD: z.string().optional(),
  PRE_SIM_CACHE_TTL_BLOCKS: z.string().optional(),
  GAS_LADDER_ENABLED: z.string().optional(),
  GAS_LADDER_FAST_TIP_GWEI: z.string().optional(),
  GAS_LADDER_MID_TIP_GWEI: z.string().optional(),
  GAS_LADDER_SAFE_TIP_GWEI: z.string().optional(),
  APPROVALS_AUTO_SEND: z.string().optional(),
  
  // Ultra-Low-Latency Execution Path Configuration
  // Transaction submit mode: public (default), private, race, bundle
  TX_SUBMIT_MODE: z.string().optional(),
  // Private transaction RPC URL (single relay endpoint)
  PRIVATE_TX_RPC_URL: z.string().optional(),
  // Execution read RPC URLs (comma-separated, defaults to RPC_URL)
  EXECUTION_READ_RPC_URLS: z.string().optional(),
  // Block boundary dispatch configuration
  BLOCK_BOUNDARY_ENABLED: z.string().optional(),
  BLOCK_BOUNDARY_SEND_MS_BEFORE: z.string().optional(),
  MAX_DISPATCHES_PER_BLOCK: z.string().optional(),
  // Hot/warm HF thresholds (basis points)
  HOT_HF_THRESHOLD_BPS: z.string().optional(),
  FAST_LANE_HF_BUFFER_BPS: z.string().optional(),
  // Minimum liquidation size for execution
  MIN_LIQ_EXEC_USD: z.string().optional(),
  // Intent builder configuration
  MAX_INTENT_AGE_MS: z.string().optional(),
  GAS_LIMIT_BUFFER: z.string().optional(),
  // Price hot cache configuration
  PRICE_HOT_CACHE_INTERVAL_MS: z.string().optional(),
  PRICE_HOT_STALE_MS: z.string().optional(),
  PRICE_HOT_MAX_ASSETS: z.string().optional(),
  
  // ==== SPRINTER HIGH-PRIORITY EXECUTION PATH ====
  // Sprinter feature flag
  SPRINTER_ENABLED: z.string().optional(),
  // Pre-staging HF threshold (BPS, e.g., 10200 = 1.02)
  PRESTAGE_HF_BPS: z.string().optional(),
  // Maximum pre-staged candidates
  SPRINTER_MAX_PRESTAGED: z.string().optional(),
  // Blocks after which pre-staged candidates are considered stale
  SPRINTER_STALE_BLOCKS: z.string().optional(),
  // Micro-verification batch size
  SPRINTER_VERIFY_BATCH: z.string().optional(),
  // Multiple write RPC URLs (comma-separated)
  WRITE_RPCS: z.string().optional(),
  // Write race timeout in milliseconds
  WRITE_RACE_TIMEOUT_MS: z.string().optional(),
  // Optimistic execution mode flag
  OPTIMISTIC_ENABLED: z.string().optional(),
  // Optimistic epsilon (BPS, e.g., 20 = 0.20%)
  OPTIMISTIC_EPSILON_BPS: z.string().optional(),
  // Multiple execution private keys (comma-separated)
  EXECUTION_PRIVATE_KEYS: z.string().optional(),
  // Template refresh index (BPS, e.g., 10000 = refresh every 10000 blocks)
  TEMPLATE_REFRESH_INDEX_BPS: z.string().optional(),
  
  // ==== REDIS L2 CACHE & COORDINATION ====
  // Redis pipelining configuration
  REDIS_ENABLE_PIPELINING: z.string().optional(),
  REDIS_MAX_PIPELINE: z.string().optional(),
  RISK_CACHE_COMPRESS: z.string().optional(),
  
  // ==== PREDICTIVE HEALTH FACTOR ENGINE ====
  PREDICTIVE_ENABLED: z.string().optional(),
  PREDICTIVE_HF_BUFFER_BPS: z.string().optional(),
  PREDICTIVE_MAX_USERS_PER_TICK: z.string().optional(),
  PREDICTIVE_HORIZON_SEC: z.string().optional(),
  PREDICTIVE_SCENARIOS: z.string().optional(),
  // Predictive integration with execution pipeline
  PREDICTIVE_QUEUE_ENABLED: z.string().optional(),
  PREDICTIVE_MICRO_VERIFY_ENABLED: z.string().optional(),
  PREDICTIVE_FASTPATH_ENABLED: z.string().optional(),
  // Predictive near-band filtering (RPC optimization)
  PREDICTIVE_NEAR_ONLY: z.string().optional(),
  PREDICTIVE_NEAR_BAND_BPS: z.string().optional(),
  // Dynamic buffer scaling based on volatility
  PREDICTIVE_DYNAMIC_BUFFER_ENABLED: z.string().optional(),
  PREDICTIVE_VOLATILITY_BPS_SCALE_MIN: z.string().optional(),
  PREDICTIVE_VOLATILITY_BPS_SCALE_MAX: z.string().optional(),
  // Predictive fallback evaluation intervals
  PREDICTIVE_FALLBACK_INTERVAL_BLOCKS: z.string().optional(),
  PREDICTIVE_FALLBACK_INTERVAL_MS: z.string().optional(),
  // Predictive fallback feature flags
  PREDICTIVE_FALLBACK_ENABLED: z.string().optional(),
  PREDICTIVE_FALLBACK_NEAR_ONLY: z.string().optional(),
  // Fast-path predictive ETA cap
  FASTPATH_PREDICTIVE_ETA_CAP_SEC: z.string().optional(),
  // Predictive priority score weights
  PREDICTIVE_PRIORITY_HF_WEIGHT: z.string().optional(),
  PREDICTIVE_PRIORITY_ETA_WEIGHT: z.string().optional(),
  PREDICTIVE_PRIORITY_DEBT_WEIGHT: z.string().optional(),
  PREDICTIVE_PRIORITY_SCENARIO_WEIGHT_BASELINE: z.string().optional(),
  PREDICTIVE_PRIORITY_SCENARIO_WEIGHT_ADVERSE: z.string().optional(),
  PREDICTIVE_PRIORITY_SCENARIO_WEIGHT_EXTREME: z.string().optional(),
  // ==== PREDICTIVE RPC OPTIMIZATION (PR #181) ====
  // Signal-based gating (default: disabled to prevent unsignaled runs)
  PREDICTIVE_SIGNAL_GATE_ENABLED: z.string().optional(),
  // Pyth delta threshold for triggering predictive (default: 0.01 = 1%)
  PREDICTIVE_PYTH_DELTA_PCT: z.string().optional(),
  // Budget enforcement
  PREDICTIVE_MAX_TICKS_PER_MIN: z.string().optional(),
  PREDICTIVE_RPC_BUDGET_USD_PER_HOUR: z.string().optional(),
  PREDICTIVE_MAX_USERS_PER_SIGNAL_PER_ASSET: z.string().optional(),
  // Deduplication
  PREDICTIVE_DEDUP_CACHE_TTL_SEC: z.string().optional(),
  PREDICTIVE_DEDUP_CACHE_MAX_SIZE: z.string().optional(),
  // Per-user debounce
  PER_USER_BLOCK_DEBOUNCE: z.string().optional(),
  // Index jump gating
  INDEX_JUMP_PREDICTION_ENABLED: z.string().optional(),
  INDEX_JUMP_MIN_BPS: z.string().optional(),
  
  // ==== MICRO-VERIFICATION FAST PATH ====
  // Enable micro-verification for immediate single-user HF checks
  MICRO_VERIFY_ENABLED: z.string().optional(),
  // Maximum micro-verifications per block
  MICRO_VERIFY_MAX_PER_BLOCK: z.string().optional(),
  // Minimum interval between micro-verify runs (ms)
  MICRO_VERIFY_INTERVAL_MS: z.string().optional(),
  // Near-threshold band in basis points (e.g., 30 = 0.30%)
  NEAR_THRESHOLD_BAND_BPS: z.string().optional(),
  // Maximum users in reserve fast-subset recheck
  RESERVE_FAST_SUBSET_MAX: z.string().optional(),
  // Head critical batch size for near-threshold segment
  HEAD_CRITICAL_BATCH_SIZE: z.string().optional(),
  // Micro-verify cache TTL in milliseconds (default: 2000)
  // MICRO_VERIFY_HF_CACHE_TTL_MS is the preferred name (matches metric naming)
  // MICRO_VERIFY_CACHE_TTL_MS is kept for backward compatibility
  MICRO_VERIFY_CACHE_TTL_MS: z.string().optional(),
  MICRO_VERIFY_HF_CACHE_TTL_MS: z.string().optional(),
  // Near-band basis points for HF filtering (default: 30 = 0.30%)
  NEAR_BAND_BPS: z.string().optional(),
  
  // ==== TIER 0 + TIER 1 PERFORMANCE UPGRADES ====
  // Tier 0: Fast Subset Before Large Sweeps
  RESERVE_FAST_SUBSET_SWEEP_DELAY_MS: z.string().optional(),
  
  // Tier 0: Disable Hedging For Single Micro-Verifies
  MICRO_VERIFY_HEDGE_FOR_SINGLE: z.string().optional(),
  MICRO_VERIFY_DEDICATED_RPC: z.string().optional(),
  
  // Tier 0: Post-Liquidation Refresh
  POST_LIQUIDATION_REFRESH: z.string().optional(),
  
  // Tier 0: Address Normalization
  ADDRESS_NORMALIZE_LOWERCASE: z.string().optional(),
  
  // Tier 1: Index Jump Prediction
  INDEX_JUMP_BPS_TRIGGER: z.string().optional(),
  HF_PRED_CRITICAL: z.string().optional(),
  
  // Tier 1: Risk Ordering Enhancement
  RISK_ORDERING_SIMPLE: z.string().optional(),
  
  // ==== CRITICAL LANE FOR SUB-1.0 HF LIQUIDATIONS ====
  // Enable critical lane fast path for HF < 1.0
  CRITICAL_LANE_ENABLED: z.string().optional(),
  // Minimum profit threshold in USD (0 allows all, for testing)
  CRITICAL_LANE_PROFIT_MIN_USD: z.string().optional(),
  // Allow unprofitable execution on first attempt (for reliability testing)
  CRITICAL_LANE_ALLOW_UNPROFITABLE_INITIAL: z.string().optional(),
  // Latency warning threshold in milliseconds
  CRITICAL_LANE_LATENCY_WARN_MS: z.string().optional(),
  // Load shedding: suppress head sweeps while critical attempts in-flight
  CRITICAL_LANE_LOAD_SHED: z.string().optional(),
  // Reverification mode: snapshot_only | mini_multicall
  CRITICAL_LANE_REVERIFY_MODE: z.string().optional(),
  // Maximum reserves to include in mini-multicall reverify
  CRITICAL_LANE_MAX_REVERIFY_RESERVES: z.string().optional(),
  // Abort attempt if latency exceeds this threshold (ms)
  CRITICAL_LANE_LATENCY_ABORT_MS: z.string().optional(),
  // Override minimum debt USD for fast path
  CRITICAL_LANE_MIN_DEBT_USD: z.string().optional(),
  // Override minimum profit USD for fast path
  CRITICAL_LANE_MIN_PROFIT_USD: z.string().optional(),
  // Price fast TTL (ms) - how long prices from snapshot are valid
  PRICE_FAST_TTL_MS: z.string().optional(),
  // User snapshot TTL (ms) - how long user snapshots are valid
  USER_SNAPSHOT_TTL_MS: z.string().optional(),
  // Template refresh interval (ms) - how often to refresh calldata templates
  TEMPLATE_REFRESH_INTERVAL_MS: z.string().optional(),
  // Fast gas mode: cache_then_estimate | estimate_only | cache_only
  FAST_GAS_MODE: z.string().optional(),
  // Private TX RPC URL for builder submission
  PRIVATE_TX_RPC: z.string().optional(),
  // Private TX mode: bundle | direct | disabled
  PRIVATE_TX_MODE: z.string().optional(),
  // Redis pipeline enabled for batch operations
  REDIS_PIPELINE_ENABLED: z.string().optional(),
  
  // ==== FASTPATH LATENCY & INSTRUMENTATION ====
  // Enable fast-path latency instrumentation
  FASTPATH_LATENCY_ENABLED: z.string().optional(),
  // Enable hedge suppression for small chunks (≤5 calls)
  FASTPATH_HEDGE_SMALL_DISABLE: z.string().optional(),
  // Price cache TTL for fast-path (milliseconds)
  FASTPATH_PRICE_CACHE_TTL_MS: z.string().optional(),
  // Gas cache TTL for fast-path (milliseconds)
  FASTPATH_GAS_CACHE_TTL_MS: z.string().optional(),
  // Enable event publishing to critical_lane.events channel
  FASTPATH_EVENT_PUBLISH: z.string().optional(),
  // Minimum HF threshold for publishing to critical lane (default: 1.0)
  CRITICAL_LANE_PUBLISH_MIN_HF: z.string().optional(),
  // Minimum HF threshold for executing via critical lane (default: 1.0)
  CRITICAL_LANE_MIN_EXECUTE_HF: z.string().optional(),
  // Enable detailed fast-path logging
  FASTPATH_LOG_DETAIL: z.string().optional(),
  // Enable fast-path latency metrics (Prometheus)
  FASTPATH_LATENCY_METRICS: z.string().optional(),
  
  // ==== FILE LOGGING CONFIGURATION ====
  // Enable file logging with daily rotation
  LOG_FILE_ENABLED: z.string().optional(),
  // File log retention in hours (default: 8)
  LOG_FILE_RETENTION_HOURS: z.string().optional(),
  
  // ==== PYTH NETWORK INTEGRATION ====
  // Enable Pyth price feeds for predictive early-warning
  PYTH_ENABLED: z.string().optional(),
  // Pyth WebSocket URL for price streaming
  PYTH_WS_URL: z.string().optional(),
  // Pyth HTTP URL for price history
  PYTH_HTTP_URL: z.string().optional(),
  // Comma-separated list of asset symbols to track (e.g., WETH,WBTC,cbETH)
  PYTH_ASSETS: z.string().optional(),
  // Maximum age in seconds before price considered stale
  PYTH_STALE_SECS: z.string().optional(),
  // Path to JSON file mapping asset symbols to Pyth feed IDs
  PYTH_FEED_MAP_PATH: z.string().optional(),
  
  // ==== TWAP SANITY CHECK CONFIGURATION ====
  // Enable DEX TWAP sanity checking
  TWAP_ENABLED: z.string().optional(),
  // TWAP window in seconds (default: 300 = 5 minutes)
  TWAP_WINDOW_SEC: z.string().optional(),
  // Maximum allowed price deviation percentage (default: 0.012 = 1.2%)
  TWAP_DELTA_PCT: z.string().optional(),
  // JSON array of pool configs: [{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3"}]
  TWAP_POOLS: z.string().optional(),
  
  // ==== PRE-SUBMIT LIQUIDATION PIPELINE ====
  // Enable pre-submit liquidation transactions ahead of Chainlink updates
  PRE_SUBMIT_ENABLED: z.string().optional(),
  // Maximum ETA in seconds to consider for pre-submit (default: 90)
  PRE_SUBMIT_ETA_MAX: z.string().optional(),
  // Health factor trigger buffer (default: 1.02)
  HF_TRIGGER_BUFFER: z.string().optional(),
  // Gas price margin/buffer percentage (default: 0.10 = 10%)
  GAS_PRICE_MARGIN: z.string().optional(),
  // Time-to-live in blocks for pending pre-submits (default: 40)
  TTL_BLOCKS: z.string().optional(),
  // Minimum position size in USD (optional, defaults to MIN_DEBT_USD)
  PRE_SUBMIT_MIN_POSITION_USD: z.string().optional(),
  // Enable telemetry for pre-submit pipeline
  TELEMETRY_PRE_SUBMIT_ENABLED: z.string().optional()
});

export const env = (() => {
  const parsed = rawEnvSchema.parse(process.env);
  const useMock = booleanString.parse(parsed.USE_MOCK_SUBGRAPH || 'false');
  const useSubgraph = (parsed.USE_SUBGRAPH || 'false').toLowerCase() === 'true';

  // Only enforce gateway secrets when USE_SUBGRAPH=true AND not mocking AND not in test mode
  if (useSubgraph && !useMock && !isTest) {
    if (!parsed.GRAPH_API_KEY) throw new Error('GRAPH_API_KEY required when USE_SUBGRAPH=true and USE_MOCK_SUBGRAPH=false');
    if (!parsed.SUBGRAPH_DEPLOYMENT_ID) throw new Error('SUBGRAPH_DEPLOYMENT_ID required when USE_SUBGRAPH=true and USE_MOCK_SUBGRAPH=false');
  }

  return {
    port: Number(parsed.PORT || 3000),
    nodeEnv: parsed.NODE_ENV || 'development',
    apiKey: parsed.API_KEY,
    jwtSecret: parsed.JWT_SECRET,
    useMockSubgraph: useMock,

    graphApiKey: parsed.GRAPH_API_KEY,
    subgraphDeploymentId: parsed.SUBGRAPH_DEPLOYMENT_ID,
    subgraphPollIntervalMs: Number(parsed.SUBGRAPH_POLL_INTERVAL_MS || 15000),
    subgraphDebugErrors: (parsed.SUBGRAPH_DEBUG_ERRORS || '').toLowerCase() === 'true',

    liquidationPollLimit: Number(parsed.LIQUIDATION_POLL_LIMIT || 50),
    liquidationTrackMax: Number(parsed.LIQUIDATION_TRACK_MAX || 5000),

    subgraphFailureThreshold: Number(parsed.SUBGRAPH_FAILURE_THRESHOLD || 5),
    subgraphRetryAttempts: Number(parsed.SUBGRAPH_RETRY_ATTEMPTS || 3),
    subgraphRetryBaseMs: Number(parsed.SUBGRAPH_RETRY_BASE_MS || 150),
    subgraphRateLimitCapacity: Number(parsed.SUBGRAPH_RATE_LIMIT_CAPACITY || 30),
    subgraphRateLimitIntervalMs: Number(parsed.SUBGRAPH_RATE_LIMIT_INTERVAL_MS || 10000),

    aavePoolAddress: parsed.AAVE_POOL_ADDRESS || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    
    // Aave V3 Base Data Provider addresses
    aaveAddressesProvider: parsed.AAVE_ADDRESSES_PROVIDER || '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
    aaveProtocolDataProvider: parsed.AAVE_PROTOCOL_DATA_PROVIDER || '0xC4Fcf9893072d61Cc2899C0054877Cb752587981',
    aaveOracle: parsed.AAVE_ORACLE || '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',
    aavePoolConfigurator: parsed.AAVE_POOL_CONFIGURATOR || '0x5731a04B1E775f0fdd454Bf70f3335886e9A96be',
    aaveUiPoolDataProvider: parsed.AAVE_UI_POOL_DATA_PROVIDER || '0x68100bD5345eA474D93577127C11F39FF8463e93',
    aaveWrappedTokenGateway: parsed.AAVE_WRAPPED_TOKEN_GATEWAY || '0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24',

    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    redisHost: parsed.REDIS_HOST || '127.0.0.1',
    redisPort: Number(parsed.REDIS_PORT || 6379),

    refinancingFeeBps: Number(parsed.REFINANCING_FEE_BPS || 15),
    emergencyFeeBps: Number(parsed.EMERGENCY_FEE_BPS || 50),

    // Telegram notifications
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,

    // Health monitoring
    healthAlertThreshold: Number(parsed.HEALTH_ALERT_THRESHOLD || 1.10),
    healthEmergencyThreshold: Number(parsed.HEALTH_EMERGENCY_THRESHOLD || 1.05),

    // Profit estimation
    profitFeeBps: Number(parsed.PROFIT_FEE_BPS || 30),
    profitMinUsd: Number(parsed.PROFIT_MIN_USD || 5),

    // Price oracle
    priceOracleMode: parsed.PRICE_ORACLE_MODE || 'coingecko',

    // Health factor resolver
    healthUserCacheTtlMs: Number(parsed.HEALTH_USER_CACHE_TTL_MS || 60000),
    healthMaxBatch: Number(parsed.HEALTH_MAX_BATCH || 25),
    healthQueryMode: parsed.HEALTH_QUERY_MODE || 'on_demand',

    // Poll configuration
    pollLimit: Number(parsed.POLL_LIMIT || 5),
    ignoreBootstrapBatch: (parsed.IGNORE_BOOTSTRAP_BATCH || 'true').toLowerCase() === 'true',

    // Gas cost estimation (default 0.5 USD)
    gasCostUsd: Number(parsed.GAS_COST_USD || 0.5),

    // Chainlink price feeds
    chainlinkRpcUrl: parsed.CHAINLINK_RPC_URL,
    chainlinkFeeds: parsed.CHAINLINK_FEEDS,
    priceStalenessSeconds: Number(parsed.PRICE_STALENESS_SEC || 900), // 15 minutes default
    ratioPriceEnabled: (parsed.RATIO_PRICE_ENABLED || 'true').toLowerCase() === 'true',
    
    // Price feed aliases and derived assets
    priceFeedAliases: parsed.PRICE_FEED_ALIASES,
    derivedRatioFeeds: parsed.DERIVED_RATIO_FEEDS,
    pricePollDisableAfterErrors: Number(parsed.PRICE_POLL_DISABLE_AFTER_ERRORS || 3),
    
    // Price readiness and deferred valuation
    priceDeferUntilReady: (parsed.PRICE_DEFER_UNTIL_READY || 'true').toLowerCase() === 'true',
    priceSymbolAliases: parsed.PRICE_SYMBOL_ALIASES,

    // Price-triggered emergency scans
    priceTriggerEnabled: (parsed.PRICE_TRIGGER_ENABLED || 'false').toLowerCase() === 'true',
    priceTriggerDropBps: Number(parsed.PRICE_TRIGGER_DROP_BPS || 12),
    priceTriggerMaxScan: Number(parsed.PRICE_TRIGGER_MAX_SCAN || 250),
    priceTriggerAssets: parsed.PRICE_TRIGGER_ASSETS || 'WETH',
    priceTriggerDebounceSec: Number(parsed.PRICE_TRIGGER_DEBOUNCE_SEC || 60),
    priceTriggerCumulative: (parsed.PRICE_TRIGGER_CUMULATIVE || 'false').toLowerCase() === 'true',
    priceTriggerPollSec: (() => {
      const rawValue = Number(parsed.PRICE_TRIGGER_POLL_SEC || 15);
      if (rawValue === 0) {
        // 0 means "disable polling fallback"
        return 0;
      }
      if (rawValue > 0 && rawValue < 5) {
        // Values <5 are clamped to 5 with warning (logged in RealTimeHFService)
        return 5;
      }
      return rawValue;
    })(),
    
    // Per-asset price trigger configuration
    priceTriggerBpsByAsset: parsed.PRICE_TRIGGER_BPS_BY_ASSET ?? 'WETH:12',
    priceTriggerDebounceByAsset: parsed.PRICE_TRIGGER_DEBOUNCE_BY_ASSET ?? 'WETH:5',
    
    // Price trigger stablecoin filtering
    priceTriggerSkipStables: (parsed.PRICE_TRIGGER_SKIP_STABLES || 'true').toLowerCase() === 'true',
    priceTriggerStablecoinList: (parsed.PRICE_TRIGGER_STABLECOIN_LIST || 'USDC,USDBC,EURC,GHO')
      .split(',')
      .map((s: string) => s.trim().toUpperCase())
      .filter((s: string) => s.length > 0),
    
    // Price trigger near-band gating
    priceTriggerNearBandOnly: (parsed.PRICE_TRIGGER_NEAR_BAND_ONLY || 'true').toLowerCase() === 'true',
    priceTriggerNearBandBps: Number(parsed.PRICE_TRIGGER_NEAR_BAND_BPS || 30),
    priceTriggerReserveTopN: Number(parsed.PRICE_TRIGGER_RESERVE_TOP_N || 400),
    priceTriggerJitterMinMs: Number(parsed.PRICE_TRIGGER_JITTER_MIN_MS || 40),
    priceTriggerJitterMaxMs: Number(parsed.PRICE_TRIGGER_JITTER_MAX_MS || 60),
    priceTriggerNearBandLowerBound: Number(parsed.PRICE_TRIGGER_NEAR_BAND_LOWER_BOUND || 0.5),
    priceTriggerMinIntervalSec: Number(parsed.PRICE_TRIGGER_MIN_INTERVAL_SEC || 10),
    priceTriggerGlobalRateLimit: (parsed.PRICE_TRIGGER_GLOBAL_RATE_LIMIT || 'on').toLowerCase() === 'on',
    
    // Auto-discovery of Chainlink feeds and debt tokens
    autoDiscoverFeeds: (parsed.AUTO_DISCOVER_FEEDS || 'true').toLowerCase() === 'true',
    
    // Reserve-targeted recheck configuration
    reserveRecheckTopN: Number(parsed.RESERVE_RECHECK_TOP_N || 800),
    reserveRecheckMaxBatch: Number(parsed.RESERVE_RECHECK_MAX_BATCH || 1200),
    reserveRecheckTopNByAsset: parsed.RESERVE_RECHECK_TOP_N_BY_ASSET,
    reserveRecheckNearBandOnly: (parsed.RESERVE_RECHECK_NEAR_BAND_ONLY || 'true').toLowerCase() === 'true',
    reserveMinIndexDeltaBps: Number(parsed.RESERVE_MIN_INDEX_DELTA_BPS || 2), // 0.02%
    
    // Global RPC rate limiting
    globalRpcRateLimit: Number(parsed.GLOBAL_RPC_RATE_LIMIT || 50), // 50 calls/sec
    globalRpcBurstCapacity: Number(parsed.GLOBAL_RPC_BURST_CAPACITY || 100), // 100 tokens
    ethCallTransport: (parsed.ETH_CALL_TRANSPORT || 'HTTP').toUpperCase() as 'HTTP' | 'WS',
    ethCallMaxInFlight: Number(parsed.ETH_CALL_MAX_IN_FLIGHT || 120),
    
    // Pending-state verification
    pendingVerifyEnabled: (parsed.PENDING_VERIFY_ENABLED || 'true').toLowerCase() === 'true',
    
    // BorrowersIndex configuration
    borrowersIndexEnabled: (parsed.BORROWERS_INDEX_ENABLED || 'false').toLowerCase() === 'true',
    borrowersIndexMode: parsed.BORROWERS_INDEX_MODE || 'memory',
    borrowersIndexRedisUrl: parsed.BORROWERS_INDEX_REDIS_URL,
    borrowersIndexMaxUsersPerReserve: Number(parsed.BORROWERS_INDEX_MAX_USERS_PER_RESERVE || 3000),
    borrowersIndexBackfillBlocks: Number(parsed.BORROWERS_INDEX_BACKFILL_BLOCKS || 400000),
    borrowersIndexChunkBlocks: Number(parsed.BORROWERS_INDEX_CHUNK_BLOCKS || 2000),
    
    // Startup diagnostics
    startupDiagnostics: (parsed.STARTUP_DIAGNOSTICS || 'true').toLowerCase() === 'true',
    startupDiagTimeoutMs: Number(parsed.STARTUP_DIAG_TIMEOUT_MS || 10000),
    
    // Mempool transmit monitoring
    transmitMempoolEnabled: (parsed.TRANSMIT_MEMPOOL_ENABLED || 'false').toLowerCase() === 'true',
    mempoolSubscriptionMode: parsed.MEMPOOL_SUBSCRIPTION_MODE || 'auto',
    
    // Latency metrics
    latencyMetricsEnabled: (parsed.LATENCY_METRICS_ENABLED || 'false').toLowerCase() === 'true',
    metricsEmitIntervalBlocks: Number(parsed.METRICS_EMIT_INTERVAL_BLOCKS || 10),

    // At-risk user scanning
    atRiskScanLimit: Number(parsed.AT_RISK_SCAN_LIMIT || 0),
    atRiskWarnThreshold: Number(parsed.AT_RISK_WARN_THRESHOLD || 1.05),
    atRiskLiqThreshold: Number(parsed.AT_RISK_LIQ_THRESHOLD || 1.0),
    atRiskDustEpsilon: Number(parsed.AT_RISK_DUST_EPSILON || 1e-9),
    atRiskNotifyWarn: (parsed.AT_RISK_NOTIFY_WARN || 'false').toLowerCase() === 'true',
    atRiskNotifyCritical: (parsed.AT_RISK_NOTIFY_CRITICAL || 'true').toLowerCase() === 'true',

    // Execution scaffold
    executionEnabled: (parsed.EXECUTION_ENABLED || 'false').toLowerCase() === 'true',
    dryRunExecution: (parsed.DRY_RUN_EXECUTION || 'true').toLowerCase() === 'true',
    privateBundleRpc: parsed.PRIVATE_BUNDLE_RPC,
    maxGasPriceGwei: Number(parsed.MAX_GAS_PRICE_GWEI || 50),
    minProfitAfterGasUsd: Number(parsed.MIN_PROFIT_AFTER_GAS_USD || 10),
    maxPositionSizeUsd: Number(parsed.MAX_POSITION_SIZE_USD || 5000),
    dailyLossLimitUsd: Number(parsed.DAILY_LOSS_LIMIT_USD || 1000),
    blacklistedTokens: (parsed.BLACKLISTED_TOKENS || '')
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0),

    // On-chain executor
    executorAddress: parsed.EXECUTOR_ADDRESS,
    executionPrivateKey: parsed.EXECUTION_PRIVATE_KEY,
    rpcUrl: parsed.RPC_URL,
    chainId: Number(parsed.CHAIN_ID || 8453),
    oneInchApiKey: parsed.ONEINCH_API_KEY,
    oneInchBaseUrl: parsed.ONEINCH_BASE_URL || 'https://api.1inch.dev/swap/v6.0/8453',
    maxSlippageBps: Number(parsed.MAX_SLIPPAGE_BPS || 100),
    closeFactorMode: parsed.CLOSE_FACTOR_MODE || 'auto',
    closeFactorExecutionMode: parsed.CLOSE_FACTOR_EXECUTION_MODE || 'fixed50',
    liquidationDebtAssets: (parsed.LIQUIDATION_DEBT_ASSETS || '')
      .split(',')
      .map(a => a.trim().toLowerCase())
      .filter(a => a.length > 0),
    minRepayUsd: Number(parsed.MIN_REPAY_USD || 50),
    maxTargetUsersPerTick: Number(parsed.MAX_TARGET_USERS_PER_TICK || 100),

    // Real-time HF detection
    useRealtimeHF: (parsed.USE_REALTIME_HF || 'false').toLowerCase() === 'true',
    wsRpcUrl: parsed.WS_RPC_URL,
    useFlashblocks: (parsed.USE_FLASHBLOCKS || 'false').toLowerCase() === 'true',
    flashblocksWsUrl: parsed.FLASHBLOCKS_WS_URL,
    flashblocksTickMs: Number(parsed.FLASHBLOCKS_TICK_MS || 250),
    multicall3Address: parsed.MULTICALL3_ADDRESS || '0xca11bde05977b3631167028862be2a173976ca11',
    aavePool: parsed.AAVE_POOL || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    executionHfThresholdBps: Number(parsed.EXECUTION_HF_THRESHOLD_BPS || 9800),
    realtimeSeedIntervalSec: Number(parsed.REALTIME_SEED_INTERVAL_SEC || 45),
    candidateMax: Number(parsed.CANDIDATE_MAX || 300),
    hysteresisBps: Number(parsed.HYSTERESIS_BPS || 20),
    notifyOnlyWhenActionable: (parsed.NOTIFY_ONLY_WHEN_ACTIONABLE || 'true').toLowerCase() === 'true',
    executionInflightLock: (parsed.EXECUTION_INFLIGHT_LOCK || 'true').toLowerCase() === 'true',

    // Subgraph usage gating
    useSubgraph: (parsed.USE_SUBGRAPH || 'false').toLowerCase() === 'true',

    // Subgraph refresh interval (default: 30 minutes)
    subgraphRefreshMinutes: Number(parsed.SUBGRAPH_REFRESH_MINUTES || 30),

    // On-chain backfill for candidate discovery
    realtimeInitialBackfillEnabled: (parsed.REALTIME_INITIAL_BACKFILL_ENABLED || 'true').toLowerCase() === 'true',
    realtimeInitialBackfillBlocks: Number(parsed.REALTIME_INITIAL_BACKFILL_BLOCKS || 50000),
    realtimeInitialBackfillChunkBlocks: Number(parsed.REALTIME_INITIAL_BACKFILL_CHUNK_BLOCKS || 2000),
    realtimeInitialBackfillMaxLogs: Number(parsed.REALTIME_INITIAL_BACKFILL_MAX_LOGS || 20000),
    backfillRpcUrl: parsed.BACKFILL_RPC_URL,

    // Subgraph paging (when USE_SUBGRAPH=true)
    // Respect The Graph's max 1000 limit
    subgraphPageSize: Math.max(50, Math.min(1000, Number(parsed.SUBGRAPH_PAGE_SIZE || 100))),

    // Head-check paging/rotation
    headCheckPageStrategy: (parsed.HEAD_CHECK_PAGE_STRATEGY || 'paged') as 'all' | 'paged',
    headCheckPageSize: Number(parsed.HEAD_CHECK_PAGE_SIZE || 250),

    // Always-include low-HF threshold
    // Default: 1.10 (matches DEFAULT_ALWAYS_INCLUDE_HF_BELOW in RealTimeHFService)
    alwaysIncludeHfBelow: Number(parsed.ALWAYS_INCLUDE_HF_BELOW || 1.10),

    // Optional secondary RPC for head-check fallback
    secondaryHeadRpcUrl: parsed.SECONDARY_HEAD_RPC_URL,

    // Hedge window for early secondary provider race (default: 300ms, set to 0 to disable)
    // When > 0 and SECONDARY_HEAD_RPC_URL is configured, races primary vs secondary after this delay
    headCheckHedgeMs: Number(parsed.HEAD_CHECK_HEDGE_MS || 300),

    // Timeout and retry configuration for multicall chunks
    chunkTimeoutMs: Number(parsed.CHUNK_TIMEOUT_MS || 2000),
    chunkRetryAttempts: Number(parsed.CHUNK_RETRY_ATTEMPTS || 2),

    // Run-level watchdog configuration
    runStallAbortMs: Number(parsed.RUN_STALL_ABORT_MS || 5000),

    // WebSocket heartbeat configuration
    wsHeartbeatMs: Number(parsed.WS_HEARTBEAT_MS || 15000),

    // Multicall batch size configuration (default: 120)
    multicallBatchSize: Number(parsed.MULTICALL_BATCH_SIZE || 120),

    // Adaptive head page sizing
    headPageAdaptive: (parsed.HEAD_PAGE_ADAPTIVE || 'true').toLowerCase() === 'true',
    headPageTargetMs: Number(parsed.HEAD_PAGE_TARGET_MS || 900),
    headPageMin: Number(parsed.HEAD_PAGE_MIN || 600),
    headPageMax: Number(parsed.HEAD_PAGE_MAX || parsed.HEAD_CHECK_PAGE_SIZE || 2400),

    // Event batch coalescing and limits
    eventBatchCoalesceMs: Number(parsed.EVENT_BATCH_COALESCE_MS || 120),
    eventBatchMaxPerBlock: Number(parsed.EVENT_BATCH_MAX_PER_BLOCK || 2),
    maxParallelEventBatches: Number(parsed.MAX_PARALLEL_EVENT_BATCHES || 1),
    
    // Adaptive event concurrency
    adaptiveEventConcurrency: (parsed.ADAPTIVE_EVENT_CONCURRENCY || 'false').toLowerCase() === 'true',
    maxParallelEventBatchesHigh: Number(parsed.MAX_PARALLEL_EVENT_BATCHES_HIGH || 6),
    eventBacklogThreshold: Number(parsed.EVENT_BACKLOG_THRESHOLD || 5),
    
    // Dust threshold configuration
    dustMinUsd: parsed.DUST_MIN_USD ? Number(parsed.DUST_MIN_USD) : null,
    minDebtUsd: Number(parsed.MIN_DEBT_USD || 1),

    // ==== Phase 1 Performance Enhancements ====
    // Mempool transmit monitoring
    mempoolMonitorEnabled: (parsed.MEMPOOL_MONITOR_ENABLED || 'false').toLowerCase() === 'true',
    
    // Health factor projection
    hfProjectionEnabled: (parsed.HF_PROJECTION_ENABLED || 'false').toLowerCase() === 'true',
    hfProjectionCriticalMin: Number(parsed.HF_PROJECTION_CRITICAL_MIN || 1.00),
    hfProjectionCriticalMax: Number(parsed.HF_PROJECTION_CRITICAL_MAX || 1.03),
    hfProjectionBlocks: Number(parsed.HF_PROJECTION_BLOCKS || 1),
    
    // Reserve event coalescing
    reserveCoalesceEnabled: (parsed.RESERVE_COALESCE_ENABLED || 'true').toLowerCase() === 'true',
    reserveCoalesceWindowMs: Number(parsed.RESERVE_COALESCE_WINDOW_MS || 40),
    reserveCoalesceMaxBatch: Number(parsed.RESERVE_COALESCE_MAX_BATCH || 50),
    reserveCoalescePerReserve: (parsed.RESERVE_COALESCE_PER_RESERVE || 'false').toLowerCase() === 'true',
    
    // Performance metrics
    perfMetricsEnabled: (parsed.PERF_METRICS_ENABLED || 'true').toLowerCase() === 'true',
    perfMetricsLogIntervalMs: Number(parsed.PERF_METRICS_LOG_INTERVAL_MS || 30000),
    perfMetricsWindowMs: Number(parsed.PERF_METRICS_WINDOW_MS || 60000),
    
    // Vectorized HF calculator
    vectorizedHfEnabled: (parsed.VECTORIZED_HF_ENABLED || 'true').toLowerCase() === 'true',
    vectorizedHfCacheTtlMs: Number(parsed.VECTORIZED_HF_CACHE_TTL_MS || 10000),
    vectorizedHfMaxTtlMs: Number(parsed.VECTORIZED_HF_MAX_TTL_MS || 60000),
    vectorizedHfMinTtlMs: Number(parsed.VECTORIZED_HF_MIN_TTL_MS || 2000),

    // Low HF Tracker for observability
    lowHfTrackerEnabled: (parsed.LOW_HF_TRACKER_ENABLED || 'true').toLowerCase() === 'true',
    lowHfTrackerMax: Number(parsed.LOW_HF_TRACKER_MAX || 1000),
    lowHfRecordMode: (parsed.LOW_HF_RECORD_MODE || 'all') as 'all' | 'min',
    lowHfDumpOnShutdown: (parsed.LOW_HF_DUMP_ON_SHUTDOWN || 'true').toLowerCase() === 'true',
    lowHfSummaryIntervalSec: Number(parsed.LOW_HF_SUMMARY_INTERVAL_SEC || 900),
    lowHfExtendedEnabled: (parsed.LOW_HF_EXTENDED_ENABLED || 'true').toLowerCase() === 'true',
    
    // Liquidation close factor (default 0.5 = 50%)
    liquidationCloseFactor: Number(parsed.LIQUIDATION_CLOSE_FACTOR || 0.5),

    // Liquidation audit configuration
    liquidationAuditEnabled: (parsed.LIQUIDATION_AUDIT_ENABLED || 'true').toLowerCase() === 'true',
    liquidationAuditNotify: (parsed.LIQUIDATION_AUDIT_NOTIFY || 'true').toLowerCase() === 'true',
    liquidationAuditPriceMode: (parsed.LIQUIDATION_AUDIT_PRICE_MODE || 'aave_oracle') as 'block' | 'current' | 'aave_oracle',
    liquidationAuditSampleLimit: Number(parsed.LIQUIDATION_AUDIT_SAMPLE_LIMIT || 0),
    
    // Decision trace and classifier (default to true when audit is enabled)
    decisionTraceEnabled: (() => {
      const auditEnabled = (parsed.LIQUIDATION_AUDIT_ENABLED || 'true').toLowerCase() === 'true';
      if (parsed.DECISION_TRACE_ENABLED !== undefined) {
        return parsed.DECISION_TRACE_ENABLED.toLowerCase() === 'true';
      }
      return auditEnabled; // default to true if audit enabled
    })(),
    auditClassifierEnabled: (() => {
      const auditEnabled = (parsed.LIQUIDATION_AUDIT_ENABLED || 'true').toLowerCase() === 'true';
      if (parsed.AUDIT_CLASSIFIER_ENABLED !== undefined) {
        return parsed.AUDIT_CLASSIFIER_ENABLED.toLowerCase() === 'true';
      }
      return auditEnabled; // default to true if audit enabled
    })(),
    
    // Liquidation Miss Classifier
    missClassifierEnabled: (parsed.MISS_CLASSIFIER_ENABLED || 'false').toLowerCase() === 'true',
    missTransientBlocks: Number(parsed.MISS_TRANSIENT_BLOCKS || 3),
    missMinProfitUsd: Number(parsed.MISS_MIN_PROFIT_USD || 10),
    missGasThresholdGwei: Number(parsed.MISS_GAS_THRESHOLD_GWEI || 50),
    missEnableProfitCheck: (parsed.MISS_ENABLE_PROFIT_CHECK || 'true').toLowerCase() === 'true',
    
    // Prices via Aave Oracle
    pricesUseAaveOracle: (parsed.PRICES_USE_AAVE_ORACLE || 'false').toLowerCase() === 'true',

    // Priority Sweep configuration
    prioritySweepEnabled: (parsed.PRIORITY_SWEEP_ENABLED || 'false').toLowerCase() === 'true',
    prioritySweepIntervalMin: Number(parsed.PRIORITY_SWEEP_INTERVAL_MIN || 60),
    priorityMinDebtUsd: Number(parsed.PRIORITY_MIN_DEBT_USD || 500),
    priorityMinCollateralUsd: Number(parsed.PRIORITY_MIN_COLLATERAL_USD || 1500),
    priorityTargetSize: Number(parsed.PRIORITY_TARGET_SIZE || 12000),
    priorityMaxScanUsers: Number(parsed.PRIORITY_MAX_SCAN_USERS || 120000),
    priorityScoreDebtWeight: Number(parsed.PRIORITY_SCORE_DEBT_WEIGHT || 1.0),
    priorityScoreCollateralWeight: Number(parsed.PRIORITY_SCORE_COLLATERAL_WEIGHT || 0.8),
    priorityScoreHfPenalty: Number(parsed.PRIORITY_SCORE_HF_PENALTY || 2.5),
    priorityScoreHfCeiling: Number(parsed.PRIORITY_SCORE_HF_CEILING || 1.20),
    priorityScoreLowHfBoost: Number(parsed.PRIORITY_SCORE_LOW_HF_BOOST || 1.1),
    prioritySweepLogSummary: (parsed.PRIORITY_SWEEP_LOG_SUMMARY || 'true').toLowerCase() === 'true',
    prioritySweepMetricsEnabled: (parsed.PRIORITY_SWEEP_METRICS_ENABLED || 'true').toLowerCase() === 'true',
    prioritySweepTimeoutMs: Number(parsed.PRIORITY_SWEEP_TIMEOUT_MS || 240000),
    prioritySweepPageSize: Number(parsed.PRIORITY_SWEEP_PAGE_SIZE || 1000),
    prioritySweepInterRequestMs: Number(parsed.PRIORITY_SWEEP_INTER_REQUEST_MS || 100),
    hotlistMaxHf: Number(parsed.HOTLIST_MAX_HF || 1.05),
    
    // Hot/Warm/Cold set tracking (Hotlist)
    hotSetEnabled: (() => {
      // HOTLIST_ENABLED takes precedence over HOT_SET_ENABLED
      if (parsed.HOTLIST_ENABLED !== undefined) {
        return parsed.HOTLIST_ENABLED.toLowerCase() === 'true';
      }
      return (parsed.HOT_SET_ENABLED || 'true').toLowerCase() === 'true';
    })(),
    hotlistMinHf: Number(parsed.HOTLIST_MIN_HF || 0.99),
    hotlistMinDebtUsd: Number(parsed.HOTLIST_MIN_DEBT_USD || 5),
    hotlistMax: Number(parsed.HOTLIST_MAX || parsed.MAX_HOT_SIZE || 2000),
    hotlistRevisitSec: Number(parsed.HOTLIST_REVISIT_SEC || 5),
    hotSetHfMax: Number(parsed.HOT_SET_HF_MAX || 1.03),
    warmSetHfMax: Number(parsed.WARM_SET_HF_MAX || 1.10),
    maxHotSize: Number(parsed.MAX_HOT_SIZE || 1000),
    maxWarmSize: Number(parsed.MAX_WARM_SIZE || 5000),
    
    // Precompute configuration
    precomputeEnabled: (parsed.PRECOMPUTE_ENABLED || 'true').toLowerCase() === 'true',
    precomputeTopK: Number(parsed.PRECOMPUTE_TOP_K || 500),
    precomputeCloseFactorPct: Number(parsed.PRECOMPUTE_CLOSE_FACTOR_PCT || 50),
    precomputeReceiveAToken: (parsed.PRECOMPUTE_RECEIVE_A_TOKEN || 'false').toLowerCase() === 'true',
    
    // Price fastpath (Chainlink events)
    priceFastpathEnabled: (parsed.PRICE_FASTPATH_ENABLED || 'true').toLowerCase() === 'true',
    priceFastpathAssets: parsed.PRICE_FASTPATH_ASSETS || 'WETH,WBTC,cbETH,USDC,AAVE',
    
    // Gas strategy
    gasStrategy: parsed.GAS_STRATEGY || 'dynamic_v1',
    gasMaxFeeMultiplier: Number(parsed.GAS_MAX_FEE_MULTIPLIER || 1.3),
    gasMinPriorityGwei: Number(parsed.GAS_MIN_PRIORITY_GWEI || 0.05),
    usePrivateTx: (parsed.USE_PRIVATE_TX || 'false').toLowerCase() === 'true',
    
    // Execution Path Acceleration Configuration
    preSimEnabled: (parsed.PRE_SIM_ENABLED || 'true').toLowerCase() === 'true',
    preSimHfWindow: Number(parsed.PRE_SIM_HF_WINDOW || 1.01),
    preSimMinDebtUsd: Number(parsed.PRE_SIM_MIN_DEBT_USD || 100),
    preSimCacheTtlBlocks: Number(parsed.PRE_SIM_CACHE_TTL_BLOCKS || 2),
    gasLadderEnabled: (parsed.GAS_LADDER_ENABLED || 'true').toLowerCase() === 'true',
    gasLadderFastTipGwei: Number(parsed.GAS_LADDER_FAST_TIP_GWEI || 5),
    gasLadderMidTipGwei: Number(parsed.GAS_LADDER_MID_TIP_GWEI || 3),
    gasLadderSafeTipGwei: Number(parsed.GAS_LADDER_SAFE_TIP_GWEI || 2),
    approvalsAutoSend: (parsed.APPROVALS_AUTO_SEND || 'false').toLowerCase() === 'true',
    
    // ==== SPRINTER HIGH-PRIORITY EXECUTION PATH ====
    sprinterEnabled: (parsed.SPRINTER_ENABLED || 'false').toLowerCase() === 'true',
    prestageHfBps: Number(parsed.PRESTAGE_HF_BPS || 10200), // 1.02
    sprinterMaxPrestaged: Number(parsed.SPRINTER_MAX_PRESTAGED || 1000),
    sprinterStaleBlocks: Number(parsed.SPRINTER_STALE_BLOCKS || 10),
    sprinterVerifyBatch: Number(parsed.SPRINTER_VERIFY_BATCH || 25),
    writeRpcs: (parsed.WRITE_RPCS || '')
      .split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0),
    writeRaceTimeoutMs: Number(parsed.WRITE_RACE_TIMEOUT_MS || 2000),
    optimisticEnabled: (parsed.OPTIMISTIC_ENABLED || 'false').toLowerCase() === 'true',
    optimisticEpsilonBps: Number(parsed.OPTIMISTIC_EPSILON_BPS || 20), // 0.20%
    executionPrivateKeys: (parsed.EXECUTION_PRIVATE_KEYS || parsed.EXECUTION_PRIVATE_KEY || '')
      .split(',')
      .map(key => key.trim())
      .filter(key => key.length > 0),
    templateRefreshIndexBps: Number(parsed.TEMPLATE_REFRESH_INDEX_BPS || 10000),
    
    // ==== REDIS L2 CACHE & COORDINATION ====
    redisEnablePipelining: (parsed.REDIS_ENABLE_PIPELINING || 'true').toLowerCase() === 'true',
    redisMaxPipeline: Number(parsed.REDIS_MAX_PIPELINE || 500),
    riskCacheCompress: (parsed.RISK_CACHE_COMPRESS || 'false').toLowerCase() === 'true',
    
    // ==== PREDICTIVE HEALTH FACTOR ENGINE ====
    predictiveEnabled: (parsed.PREDICTIVE_ENABLED || 'false').toLowerCase() === 'true',
    predictiveHfBufferBps: Number(parsed.PREDICTIVE_HF_BUFFER_BPS || 40), // 0.40%
    predictiveMaxUsersPerTick: Number(parsed.PREDICTIVE_MAX_USERS_PER_TICK || 800),
    predictiveHorizonSec: Number(parsed.PREDICTIVE_HORIZON_SEC || 180), // 3 minutes
    predictiveScenarios: (parsed.PREDICTIVE_SCENARIOS || 'baseline,adverse,extreme')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0),
    predictiveQueueEnabled: (parsed.PREDICTIVE_QUEUE_ENABLED || 'true').toLowerCase() === 'true',
    predictiveMicroVerifyEnabled: (parsed.PREDICTIVE_MICRO_VERIFY_ENABLED || 'true').toLowerCase() === 'true',
    predictiveFastpathEnabled: (parsed.PREDICTIVE_FASTPATH_ENABLED || 'false').toLowerCase() === 'true',
    predictiveNearOnly: (parsed.PREDICTIVE_NEAR_ONLY || 'true').toLowerCase() === 'true',
    predictiveNearBandBps: Number(parsed.PREDICTIVE_NEAR_BAND_BPS || 30), // 0.30%
    predictiveDynamicBufferEnabled: (parsed.PREDICTIVE_DYNAMIC_BUFFER_ENABLED || 'false').toLowerCase() === 'true',
    predictiveVolatilityBpsScaleMin: Number(parsed.PREDICTIVE_VOLATILITY_BPS_SCALE_MIN || 20), // 0.20%
    predictiveVolatilityBpsScaleMax: Number(parsed.PREDICTIVE_VOLATILITY_BPS_SCALE_MAX || 100), // 1.00%
    predictiveFallbackIntervalBlocks: Number(parsed.PREDICTIVE_FALLBACK_INTERVAL_BLOCKS || 20),
    predictiveFallbackIntervalMs: Number(parsed.PREDICTIVE_FALLBACK_INTERVAL_MS || 30000), // 30 seconds
    predictiveFallbackEnabled: (parsed.PREDICTIVE_FALLBACK_ENABLED || 'false').toLowerCase() === 'true',
    predictiveFallbackNearOnly: (parsed.PREDICTIVE_FALLBACK_NEAR_ONLY || 'true').toLowerCase() === 'true',
    fastpathPredictiveEtaCapSec: Number(parsed.FASTPATH_PREDICTIVE_ETA_CAP_SEC || 45), // 45 seconds
    predictivePriorityHfWeight: Number(parsed.PREDICTIVE_PRIORITY_HF_WEIGHT || 1.0),
    predictivePriorityEtaWeight: Number(parsed.PREDICTIVE_PRIORITY_ETA_WEIGHT || 1.0),
    predictivePriorityDebtWeight: Number(parsed.PREDICTIVE_PRIORITY_DEBT_WEIGHT || 0.6),
    predictivePriorityScenarioWeightBaseline: Number(parsed.PREDICTIVE_PRIORITY_SCENARIO_WEIGHT_BASELINE || 1.0),
    predictivePriorityScenarioWeightAdverse: Number(parsed.PREDICTIVE_PRIORITY_SCENARIO_WEIGHT_ADVERSE || 1.15),
    predictivePriorityScenarioWeightExtreme: Number(parsed.PREDICTIVE_PRIORITY_SCENARIO_WEIGHT_EXTREME || 1.3),
    // Predictive RPC Optimization (PR #181)
    predictiveSignalGateEnabled: (parsed.PREDICTIVE_SIGNAL_GATE_ENABLED || 'true').toLowerCase() === 'true',
    predictivePythDeltaPct: Number(parsed.PREDICTIVE_PYTH_DELTA_PCT || 0.01),
    predictiveMaxTicksPerMin: Number(parsed.PREDICTIVE_MAX_TICKS_PER_MIN || 6),
    predictiveRpcBudgetUsdPerHour: Number(parsed.PREDICTIVE_RPC_BUDGET_USD_PER_HOUR || 1.5),
    predictiveMaxUsersPerSignalPerAsset: Number(parsed.PREDICTIVE_MAX_USERS_PER_SIGNAL_PER_ASSET || 60),
    predictiveDedupCacheTtlSec: Number(parsed.PREDICTIVE_DEDUP_CACHE_TTL_SEC || 120),
    predictiveDedupCacheMaxSize: Number(parsed.PREDICTIVE_DEDUP_CACHE_MAX_SIZE || 1000),
    perUserBlockDebounce: Number(parsed.PER_USER_BLOCK_DEBOUNCE || 3),
    indexJumpPredictionEnabled: (parsed.INDEX_JUMP_PREDICTION_ENABLED || 'false').toLowerCase() === 'true',
    indexJumpMinBps: Number(parsed.INDEX_JUMP_MIN_BPS || 6),
    
    // ==== MICRO-VERIFICATION FAST PATH ====
    microVerifyEnabled: (parsed.MICRO_VERIFY_ENABLED || 'true').toLowerCase() === 'true',
    microVerifyMaxPerBlock: Number(parsed.MICRO_VERIFY_MAX_PER_BLOCK || 25),
    microVerifyIntervalMs: Number(parsed.MICRO_VERIFY_INTERVAL_MS || 150),
    // MICRO_VERIFY_HF_CACHE_TTL_MS takes precedence (as documented), fallback to MICRO_VERIFY_CACHE_TTL_MS
    microVerifyCacheTtlMs: Number(parsed.MICRO_VERIFY_HF_CACHE_TTL_MS || parsed.MICRO_VERIFY_CACHE_TTL_MS || 1200), // 1.2 seconds
    nearThresholdBandBps: Number(parsed.NEAR_THRESHOLD_BAND_BPS || 30), // 0.30%
    nearBandBps: Number(parsed.NEAR_BAND_BPS || 30), // 0.30%
    reserveFastSubsetMax: Number(parsed.RESERVE_FAST_SUBSET_MAX || 64),
    headCriticalBatchSize: Number(parsed.HEAD_CRITICAL_BATCH_SIZE || 120),
    
    // ==== TIER 0 + TIER 1 PERFORMANCE UPGRADES ====
    // Tier 0: Fast Subset Before Large Sweeps
    reserveFastSubsetSweepDelayMs: Number(parsed.RESERVE_FAST_SUBSET_SWEEP_DELAY_MS || 80),
    
    // Tier 0: Disable Hedging For Single Micro-Verifies
    microVerifyHedgeForSingle: (parsed.MICRO_VERIFY_HEDGE_FOR_SINGLE || 'false').toLowerCase() === 'true',
    microVerifyDedicatedRpc: parsed.MICRO_VERIFY_DEDICATED_RPC,
    
    // Tier 0: Post-Liquidation Refresh
    postLiquidationRefresh: (parsed.POST_LIQUIDATION_REFRESH || 'true').toLowerCase() === 'true',
    
    // Tier 0: Address Normalization
    addressNormalizeLowercase: (parsed.ADDRESS_NORMALIZE_LOWERCASE || 'true').toLowerCase() === 'true',
    
    // File logging configuration
    logFileEnabled: (parsed.LOG_FILE_ENABLED || 'false').toLowerCase() === 'true',
    logFileRetentionHours: Number(parsed.LOG_FILE_RETENTION_HOURS || 8),
    
    // Tier 1: Index Jump Prediction
    indexJumpBpsTrigger: Number(parsed.INDEX_JUMP_BPS_TRIGGER || 3),
    hfPredCritical: Number(parsed.HF_PRED_CRITICAL || 1.0008),
    
    // Tier 1: Risk Ordering Enhancement
    riskOrderingSimple: (parsed.RISK_ORDERING_SIMPLE || 'true').toLowerCase() === 'true',
    
    // ==== PYTH NETWORK INTEGRATION ====
    pythEnabled: (parsed.PYTH_ENABLED || 'false').toLowerCase() === 'true',
    pythWsUrl: parsed.PYTH_WS_URL || 'wss://hermes.pyth.network/ws',
    pythHttpUrl: parsed.PYTH_HTTP_URL || 'https://hermes.pyth.network',
    pythAssets: (parsed.PYTH_ASSETS || 'WETH,WBTC,cbETH,USDC')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0),
    pythStaleSecs: Number(parsed.PYTH_STALE_SECS || 10),
    pythFeedMapPath: parsed.PYTH_FEED_MAP_PATH || '',
    
    // ==== TWAP SANITY CHECK CONFIGURATION ====
    twapEnabled: (parsed.TWAP_ENABLED || 'false').toLowerCase() === 'true',
    twapWindowSec: Number(parsed.TWAP_WINDOW_SEC || 300),
    twapDeltaPct: Number(parsed.TWAP_DELTA_PCT || 0.012),
    twapPools: (() => {
      try {
        return parsed.TWAP_POOLS ? JSON.parse(parsed.TWAP_POOLS) : [];
      } catch (err) {
        console.warn('[config] Failed to parse TWAP_POOLS, using empty array');
        return [];
      }
    })(),
    
    // ==== PRE-SUBMIT LIQUIDATION PIPELINE ====
    preSubmitEnabled: (parsed.PRE_SUBMIT_ENABLED || 'false').toLowerCase() === 'true',
    preSubmitEtaMax: Number(parsed.PRE_SUBMIT_ETA_MAX || 90),
    hfTriggerBuffer: Number(parsed.HF_TRIGGER_BUFFER || 1.02),
    gasPriceMargin: Number(parsed.GAS_PRICE_MARGIN || 0.10),
    ttlBlocks: Number(parsed.TTL_BLOCKS || 40),
    preSubmitMinPositionUsd: parsed.PRE_SUBMIT_MIN_POSITION_USD ? Number(parsed.PRE_SUBMIT_MIN_POSITION_USD) : undefined,
    telemetryPreSubmitEnabled: (parsed.TELEMETRY_PRE_SUBMIT_ENABLED || 'true').toLowerCase() === 'true',
    
    // ==== CRITICAL LANE FOR SUB-1.0 HF LIQUIDATIONS ====
    criticalLaneEnabled: (parsed.CRITICAL_LANE_ENABLED || 'true').toLowerCase() === 'true',
    criticalLaneProfitMinUsd: Number(parsed.CRITICAL_LANE_PROFIT_MIN_USD || 0),
    criticalLaneAllowUnprofitableInitial: (parsed.CRITICAL_LANE_ALLOW_UNPROFITABLE_INITIAL || 'false').toLowerCase() === 'true',
    criticalLaneLatencyWarnMs: Number(parsed.CRITICAL_LANE_LATENCY_WARN_MS || 250),
    criticalLaneLoadShed: (parsed.CRITICAL_LANE_LOAD_SHED || 'true').toLowerCase() === 'true',
    criticalLaneReverifyMode: parsed.CRITICAL_LANE_REVERIFY_MODE || 'mini_multicall',
    criticalLaneMaxReverifyReserves: Number(parsed.CRITICAL_LANE_MAX_REVERIFY_RESERVES || 6),
    criticalLaneLatencyAbortMs: Number(parsed.CRITICAL_LANE_LATENCY_ABORT_MS || 600),
    criticalLaneMinDebtUsd: Number(parsed.CRITICAL_LANE_MIN_DEBT_USD || 50),
    criticalLaneMinProfitUsd: Number(parsed.CRITICAL_LANE_MIN_PROFIT_USD || 10),
    priceFastTtlMs: Number(parsed.PRICE_FAST_TTL_MS || 5000),
    userSnapshotTtlMs: Number(parsed.USER_SNAPSHOT_TTL_MS || 4000),
    templateRefreshIntervalMs: Number(parsed.TEMPLATE_REFRESH_INTERVAL_MS || 60000),
    fastGasMode: parsed.FAST_GAS_MODE || 'cache_then_estimate',
    privateTxRpc: parsed.PRIVATE_TX_RPC,
    privateTxMode: parsed.PRIVATE_TX_MODE || 'disabled',
    redisPipelineEnabled: (parsed.REDIS_PIPELINE_ENABLED || 'true').toLowerCase() === 'true',
    
    // ==== FASTPATH LATENCY & INSTRUMENTATION ====
    fastpathLatencyEnabled: (parsed.FASTPATH_LATENCY_ENABLED || 'true').toLowerCase() === 'true',
    fastpathHedgeSmallDisable: (parsed.FASTPATH_HEDGE_SMALL_DISABLE || 'true').toLowerCase() === 'true',
    fastpathPriceCacheTtlMs: Number(parsed.FASTPATH_PRICE_CACHE_TTL_MS || 5000),
    fastpathGasCacheTtlMs: Number(parsed.FASTPATH_GAS_CACHE_TTL_MS || 4000),
    fastpathEventPublish: (parsed.FASTPATH_EVENT_PUBLISH || 'true').toLowerCase() === 'true',
    criticalLanePublishMinHf: Number(parsed.CRITICAL_LANE_PUBLISH_MIN_HF || 1.0),
    criticalLaneMinExecuteHf: Number(parsed.CRITICAL_LANE_MIN_EXECUTE_HF || 1.0),
    fastpathLogDetail: (parsed.FASTPATH_LOG_DETAIL || 'true').toLowerCase() === 'true',
    fastpathLatencyMetrics: (parsed.FASTPATH_LATENCY_METRICS || 'true').toLowerCase() === 'true'
  };
})();
