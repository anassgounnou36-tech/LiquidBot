// RealTimeHFService: Real-time on-chain liquidation detection via WebSocket
// Monitors Aave Pool events and blocks, performs Multicall3 batch HF checks

import EventEmitter from 'events';

import { WebSocketProvider, JsonRpcProvider, Contract, Interface, formatUnits, EventLog } from 'ethers';

import {
  eventRegistry,
  extractUserFromAaveEvent,
  extractReserveFromAaveEvent,
  formatDecodedEvent
} from '../abi/aaveV3PoolEvents.js';
import { config } from '../config/index.js';
import {
  realtimeBlocksReceived,
  realtimeAaveLogsReceived,
  realtimePriceUpdatesReceived,
  realtimeHealthChecksPerformed,
  realtimeTriggersProcessed,
  realtimeReconnects,
  realtimeCandidateCount,
  realtimeMinHealthFactor,
  liquidatableEdgeTriggersTotal,
  chunkTimeoutsTotal,
  runAbortsTotal,
  wsReconnectsTotal,
  chunkLatency,
  candidatesPrunedZeroDebt,
  candidatesPrunedTinyDebt,
  candidatesTotal,
  eventBatchesSkipped,
  eventBatchesExecuted,
  eventConcurrencyLevel,
  eventConcurrencyLevelHistogram,
  realtimePriceTriggersTotal,
  reserveRechecksTotal,
  pendingVerifyErrorsTotal,
  headstartProcessedTotal,
  headstartLatencyMs,
  priceFeedEventsTotal,
  predictiveMicroVerifyScheduledTotal,
  predictivePrestagedTotal,
  subsetIntersectionSize,
  reserveEventToMicroVerifyMs,
  realtimePriceEmergencyScansTotal,
  emergencyScanLatency,
  scansSuppressedByLock,
  scansSuppressedByDeltaGate
} from '../metrics/index.js';
import { isZero } from '../utils/bigint.js';
import { normalizeAddress } from '../utils/Address.js';
import { maybeShadowExecute, type ShadowExecCandidate } from '../exec/shadowExecution.js';

import { CandidateManager } from './CandidateManager.js';
import type { SubgraphService } from './SubgraphService.js';
import { OnChainBackfillService } from './OnChainBackfillService.js';
import { SubgraphSeeder } from './SubgraphSeeder.js';
import { BorrowersIndexService } from './BorrowersIndexService.js';
import { ReserveIndexTracker } from './ReserveIndexTracker.js';
import { LowHFTracker } from './LowHFTracker.js';
import { ScanRegistry } from './ScanRegistry.js';
import { GlobalRpcRateLimiter } from './GlobalRpcRateLimiter.js';
import { LiquidationAuditService } from './liquidationAudit.js';
import { NotificationService } from './NotificationService.js';
import { PriceService } from './PriceService.js';
import { HotSetTracker } from './HotSetTracker.js';
import { PrecomputeService } from './PrecomputeService.js';
import { DecisionTraceStore } from './DecisionTraceStore.js';
import { FeedDiscoveryService, type DiscoveredReserve } from './FeedDiscoveryService.js';
import { PerAssetTriggerConfig } from './PerAssetTriggerConfig.js';
import { AaveDataService } from './AaveDataService.js';
import { FastpathPublisher } from '../fastpath/FastpathPublisher.js';
import { createRedisClient } from '../redis/RedisClientFactory.js';
import { WatchSet } from '../watch/WatchSet.js';
import { MicroVerifyCache } from './microVerify/MicroVerifyCache.js';

// ABIs
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
];

const CHAINLINK_AGG_ABI = [
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  'event NewTransmission(uint32 indexed aggregatorRoundId, int192 answer, address transmitter, int192[] observations, bytes observers, bytes32 rawReportContext)'
];

// Chainlink aggregator interface for latestRoundData polling
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

export interface RealTimeHFServiceOptions {
  subgraphService?: SubgraphService;
  skipWsConnection?: boolean; // for testing
  notificationService?: NotificationService;
  priceService?: PriceService;
  predictiveOrchestrator?: import('../risk/PredictiveOrchestrator.js').PredictiveOrchestrator;
}

export interface LiquidatableEvent {
  userAddress: string;
  healthFactor: number;
  blockNumber: number;
  triggerType: 'event' | 'head' | 'price';
  timestamp: number;
}

/**
 * RealTimeHFService provides low-latency liquidation detection via WebSocket subscriptions.
 * Monitors Aave Pool events, newHeads, and optional Chainlink price feeds.
 * Uses Multicall3 for efficient batch health factor checks.
 * 
 * Emits 'liquidatable' events when users cross below the HF threshold.
 */
interface UserState {
  status: 'safe' | 'liq';
  lastHf: number;
  lastBlock: number;
  hfHistory?: Array<{ hf: number; block: number }>; // Rolling HF history for delta tracking
}

interface PreSimQueueEntry {
  user: string;
  projectedHf: number;
  debtUsd: number;
  timestamp: number;
}

export class RealTimeHFService extends EventEmitter {
  private provider: WebSocketProvider | JsonRpcProvider | null = null;
  private httpProvider: JsonRpcProvider | null = null; // HTTP provider for eth_call
  private multicall3: Contract | null = null;
  private multicall3Http: Contract | null = null; // Multicall3 instance for HTTP provider
  private aavePool: Contract | null = null;
  private candidateManager: CandidateManager;
  private subgraphService?: SubgraphService;
  private subgraphSeeder?: SubgraphSeeder;
  private backfillService?: OnChainBackfillService;
  private borrowersIndex?: BorrowersIndexService;
  private reserveIndexTracker?: ReserveIndexTracker;
  private lowHfTracker?: LowHFTracker;
  private liquidationAuditService?: LiquidationAuditService;
  private hotSetTracker?: HotSetTracker;
  private precomputeService?: PrecomputeService;
  private decisionTraceStore?: DecisionTraceStore;
  private feedDiscoveryService?: FeedDiscoveryService;
  private perAssetTriggerConfig?: PerAssetTriggerConfig;
  private aaveDataService?: AaveDataService;
  private discoveredReserves: DiscoveredReserve[] = [];
  private priceService?: PriceService;
  private microVerifier?: import('./MicroVerifier.js').MicroVerifier;
  private microVerifyCache: MicroVerifyCache;
  private fastpathPublisher?: FastpathPublisher;
  private watchSet?: WatchSet;
  private predictiveOrchestrator?: import('../risk/PredictiveOrchestrator.js').PredictiveOrchestrator;
  private isShuttingDown = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer?: NodeJS.Timeout;
  private seedTimer?: NodeJS.Timeout;
  private pendingBlockTimer?: NodeJS.Timeout;
  private skipWsConnection: boolean;

  // Edge-triggering state per user
  private userStates = new Map<string, UserState>();
  private lastEmitBlock = new Map<string, number>();

  // Per-block dedupe tracking (Goal 3)
  private seenUsersThisBlock = new Set<string>();
  private currentBlockNumber: number | null = null;

  // Per-block gating for price and reserve triggers (Goal 5)
  private lastPriceCheckBlock: number | null = null;
  private lastReserveCheckBlock: number | null = null;

  // Adaptive rate-limit handling (Goal 4)
  private currentChunkSize: number;
  private rateLimitBackoffMs = 0;
  private consecutiveRateLimits = 0;
  private basePendingTickMs = 250;
  private currentPendingTickMs = 250;

  // Head-check paging/rotation
  private headCheckRotatingIndex = 0;
  
  // Adaptive head page sizing tracking
  private headRunHistory: Array<{
    elapsed: number;
    timeouts: number;
    avgLatency: number;
  }> = [];
  private currentDynamicPageSize: number;
  
  // Adaptive sizing constants
  private readonly ADAPTIVE_WINDOW_SIZE = 20; // rolling window size for metrics
  private readonly ADAPTIVE_DECREASE_FACTOR = 0.85; // 15% decrease when overloaded
  private readonly ADAPTIVE_INCREASE_FACTOR = 1.12; // 12% increase when underutilized
  private readonly ADAPTIVE_TIMEOUT_THRESHOLD = 0.05; // 5% timeout rate threshold

  // Serialization + coalescing for head-check runs (Goal 1)
  private scanningHead = false;
  private latestRequestedHeadBlock: number | null = null;
  private currentRunId: string | null = null;
  
  // Run-level watchdog tracking
  private lastProgressAt: number | null = null;
  private runWatchdogTimer?: NodeJS.Timeout;
  
  // WebSocket heartbeat tracking
  private lastWsActivity: number = Date.now();
  private wsHeartbeatTimer?: NodeJS.Timeout;
  private isReconnecting = false;
  
  // Head-start feature error tracking (fail-soft)
  private headStartFeatureDisabled = false;

  // Dirty-first prioritization (Goal 2)
  private dirtyUsers = new Set<string>();
  private dirtyReserves = new Set<string>();

  // Optional secondary provider for fallback (Goal 5)
  private secondaryProvider: JsonRpcProvider | null = null;
  private secondaryMulticall3: Contract | null = null;

  // Per-run batch metrics tracking
  private currentBatchMetrics = {
    timeouts: 0,
    latencies: [] as number[],
    hedges: 0,
    primaryUsed: 0,
    secondaryUsed: 0
  };

  // Event batch coalescing
  private eventBatchQueue: Map<string, {
    users: Set<string>;
    reserves: Set<string>;
    timer: NodeJS.Timeout;
    blockNumber: number;
  }> = new Map();
  private eventBatchesPerBlock: Map<number, number> = new Map();
  private runningEventBatches = 0;
  
  // Adaptive event concurrency
  private currentMaxEventBatches: number;
  private eventBatchSkipHistory: number[] = []; // Rolling window of skipped batches (1 = skipped, 0 = executed)
  private readonly EVENT_SKIP_WINDOW_SIZE = 20;

  // Price trigger tracking for emergency scans
  private lastSeenPrices: Map<string, number> = new Map(); // feedAddress -> last price (for single-round delta mode)
  private baselinePrices: Map<string, number> = new Map(); // feedAddress -> baseline price (for cumulative mode)
  private chainlinkFeedToSymbol: Map<string, string> = new Map(); // feedAddress -> symbol
  private priceMonitorAssets: Set<string> | null = null; // null = monitor all
  private lastPriceTriggerTime: Map<string, number> = new Map(); // symbol -> timestamp in ms
  
  // Per-symbol per-block deduplication for price triggers (Goal A)
  private lastProcessedBlockBySymbol: Map<string, number> = new Map(); // symbol -> last processed block
  private inFlightPriceTriggerBySymbol: Map<string, boolean> = new Map(); // symbol -> in-flight flag
  private priceTriggerDebounceTimers: Map<string, NodeJS.Timeout> = new Map(); // symbol -> debounce timer
  
  // Per-asset state for polling fallback
  private priceAssetState: Map<string, {
    lastAnswer: bigint | null;
    lastUpdatedAt: number | null;
    lastTriggerTs: number;
    lastScanTs: number; // Track last actual scan time for min interval enforcement
    baselineAnswer: bigint | null;
  }> = new Map();
  
  // Polling timer
  private pricePollingTimer?: NodeJS.Timeout;
  
  // Pre-simulation queue for hot users
  private preSimQueue: Map<string, PreSimQueueEntry> = new Map();
  private readonly PRE_SIM_HISTORY_WINDOW = 4; // N=4 observations for delta tracking
  
  // Predictive prestage deduplication cache (user -> Set<scenario>)
  private prestageCache: Map<string, Set<string>> = new Map();
  private prestageCacheLastClearBlock = 0;
  private readonly PRESTAGE_CACHE_CLEAR_INTERVAL_BLOCKS = 2; // Clear every 2 blocks
  
  // Scan deduplication and rate limiting
  private scanRegistry: ScanRegistry;
  private globalRpcRateLimiter: GlobalRpcRateLimiter;
  
  // Near-threshold tracking for micro-verification
  private nearThresholdUsers = new Map<string, {
    hf: number;
    lastHf: number;
    block: number;
    debtUsd: number;
  }>();

  // Metrics
  private metrics = {
    blocksReceived: 0,
    aaveLogsReceived: 0,
    priceUpdatesReceived: 0,
    healthChecksPerformed: 0,
    triggersProcessed: 0,
    reconnects: 0,
    minHF: null as number | null
  };

  constructor(options: RealTimeHFServiceOptions = {}) {
    super();
    this.candidateManager = new CandidateManager({ maxCandidates: config.candidateMax });
    this.subgraphService = options.subgraphService;
    this.skipWsConnection = options.skipWsConnection || false;
    
    // Initialize micro-verify cache
    this.microVerifyCache = new MicroVerifyCache();
    
    // Initialize scan registry for deduplication (replaces ScanConcurrencyController)
    this.scanRegistry = new ScanRegistry();
    
    // Initialize global RPC rate limiter
    this.globalRpcRateLimiter = new GlobalRpcRateLimiter();
    
    // Initialize reserve index tracker for delta-based recheck optimization
    this.reserveIndexTracker = new ReserveIndexTracker();
    
    // Initialize low HF tracker if enabled
    if (config.lowHfTrackerEnabled) {
      this.lowHfTracker = new LowHFTracker();
      // eslint-disable-next-line no-console
      console.log(
        `[lowhf-tracker] Enabled: mode=${config.lowHfRecordMode} ` +
        `max=${config.lowHfTrackerMax} dumpOnShutdown=${config.lowHfDumpOnShutdown}`
      );
    }
    
    // Initialize hot-set tracker if enabled
    if (config.hotSetEnabled) {
      this.hotSetTracker = new HotSetTracker({
        hotSetHfMax: config.hotSetHfMax,
        warmSetHfMax: config.warmSetHfMax,
        maxHotSize: config.maxHotSize,
        maxWarmSize: config.maxWarmSize
      });
    }
    
    // Initialize precompute service if enabled
    if (config.precomputeEnabled) {
      this.precomputeService = new PrecomputeService({
        topK: config.precomputeTopK,
        enabled: config.precomputeEnabled,
        closeFactorPct: config.precomputeCloseFactorPct
      });
    }
    
    // Initialize decision trace store if enabled
    if (config.decisionTraceEnabled) {
      this.decisionTraceStore = new DecisionTraceStore();
      // eslint-disable-next-line no-console
      console.log('[decision-trace] Store initialized');
    }
    
    // Store price service for use in polling logic
    this.priceService = options.priceService;
    
    // Store predictive orchestrator for integration
    this.predictiveOrchestrator = options.predictiveOrchestrator;
    
    // Initialize liquidation audit service if enabled
    if (config.liquidationAuditEnabled) {
      const priceService = this.priceService || new PriceService();
      if (!this.priceService) {
        this.priceService = priceService;
      }
      const notificationService = options.notificationService || new NotificationService(priceService);
      this.liquidationAuditService = new LiquidationAuditService(
        priceService,
        notificationService,
        this.provider as any, // Will be set later in setupProvider
        this.decisionTraceStore
      );
    }
    
    // Initialize per-asset trigger config if price triggers are enabled
    if (config.priceTriggerEnabled) {
      this.perAssetTriggerConfig = new PerAssetTriggerConfig();
      // eslint-disable-next-line no-console
      console.log('[per-asset-trigger] Config initialized');
      const configured = this.perAssetTriggerConfig.getConfiguredAssets();
      if (configured.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[per-asset-trigger] Custom settings for: ${configured.join(', ')}`);
      }
    }
    
    // Initialize adaptive settings
    this.basePendingTickMs = config.flashblocksTickMs;
    this.currentPendingTickMs = config.flashblocksTickMs;
    
    // Initialize multicall batch size from config
    this.currentChunkSize = config.multicallBatchSize;
    
    // Initialize dynamic page size to current config value
    this.currentDynamicPageSize = config.headCheckPageSize;
    
    // Initialize adaptive event concurrency
    this.currentMaxEventBatches = config.maxParallelEventBatches;
    
    // Initialize price monitoring asset filter if configured (Goal B)
    if (config.priceTriggerEnabled && config.priceTriggerAssets) {
      const configuredAssets = config.priceTriggerAssets
        .split(',')
        .map((s: string) => s.trim().toUpperCase())
        .filter((s: string) => s.length > 0)
        .map((s: string) => this.normalizeAssetSymbol(s));
      
      // Build effective asset set, excluding stablecoins if skip_stables is enabled
      const stablecoins = new Set(config.priceTriggerStablecoinList);
      const effectiveAssets = config.priceTriggerSkipStables
        ? configuredAssets.filter(asset => !stablecoins.has(asset))
        : configuredAssets;
      
      this.priceMonitorAssets = new Set(effectiveAssets);
      
      // Log effective asset set
      if (config.priceTriggerSkipStables && effectiveAssets.length < configuredAssets.length) {
        const skipped = configuredAssets.filter(asset => !effectiveAssets.includes(asset));
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Stablecoins skipped: ${skipped.join(',')} ` +
          `(PRICE_TRIGGER_SKIP_STABLES=true)`
        );
      }
    }
    
    // Initialize WatchSet for watched fast-path
    if (this.hotSetTracker || this.lowHfTracker) {
      this.watchSet = new WatchSet({
        hotSetTracker: this.hotSetTracker,
        lowHFTracker: this.lowHfTracker
      });
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] WatchSet initialized for watched fast-path');
    }
    
    // Initialize fastpath publisher if enabled
    if (config.fastpathEventPublish && !this.skipWsConnection) {
      try {
        const redis = createRedisClient();
        this.fastpathPublisher = new FastpathPublisher(redis);
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] FastpathPublisher initialized');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Failed to initialize FastpathPublisher:', err);
      }
    }
  }

  /**
   * Normalize asset symbols for consistent mapping (e.g., ETH -> WETH)
   */
  private normalizeAssetSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    // Map common variations to canonical symbols
    if (upper === 'ETH') return 'WETH';
    if (upper === 'BTC') return 'WBTC';
    return upper;
  }

  /**
   * Get asset symbol for a reserve address
   */
  private getAssetSymbolForReserve(reserve: string): string | null {
    if (!this.aaveDataService) return null;
    
    // Look up reserve in discovered reserves
    const discoveredReserve = this.discoveredReserves.find(
      r => r.asset.toLowerCase() === reserve.toLowerCase()
    );
    
    return discoveredReserve?.symbol || null;
  }

  /**
   * Set TokenMetadataRegistry instance (for dependency injection)
   */
  setTokenRegistry(tokenRegistry: import('./TokenMetadataRegistry.js').TokenMetadataRegistry): void {
    // Update AaveDataService with the token registry
    if (this.aaveDataService) {
      this.aaveDataService.setTokenRegistry(tokenRegistry);
    }
  }

  /**
   * Set AaveMetadata instance (for dependency injection)
   */
  setAaveMetadata(aaveMetadata: import('../aave/AaveMetadata.js').AaveMetadata): void {
    // Update AaveDataService with the Aave metadata
    if (this.aaveDataService) {
      this.aaveDataService.setAaveMetadata(aaveMetadata);
    }
  }

  /**
   * Initialize and start the real-time service
   */
  async start(): Promise<void> {
    if (!config.useRealtimeHF) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Service disabled (USE_REALTIME_HF=false)');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Starting real-time HF detection service');
    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Configuration:', {
      useFlashblocks: config.useFlashblocks,
      multicall3: config.multicall3Address,
      aavePool: config.aavePool,
      hfThresholdBps: config.executionHfThresholdBps,
      seedInterval: config.realtimeSeedIntervalSec,
      candidateMax: config.candidateMax,
      useSubgraph: config.useSubgraph,
      backfillEnabled: config.realtimeInitialBackfillEnabled,
      headCheckPageStrategy: config.headCheckPageStrategy,
      headCheckPageSize: config.headCheckPageSize
    });
    
    // Log price-trigger configuration
    if (config.priceTriggerEnabled) {
      const assets = config.priceTriggerAssets 
        ? config.priceTriggerAssets.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        : [];
      // eslint-disable-next-line no-console
      console.log(
        `[price-trigger] enabled=true mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'} ` +
        `dropBps=${config.priceTriggerDropBps} ` +
        `maxScan=${config.priceTriggerMaxScan} debounceSec=${config.priceTriggerDebounceSec} ` +
        `assets=${assets.length > 0 ? assets.join(',') : 'ALL'}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log('[price-trigger] enabled=false');
    }
    
    // Log adaptive event concurrency configuration
    // eslint-disable-next-line no-console
    console.log(
      `[config] ADAPTIVE_EVENT_CONCURRENCY=${config.adaptiveEventConcurrency} ` +
      `(base=${config.maxParallelEventBatches}, high=${config.maxParallelEventBatchesHigh}, ` +
      `threshold=${config.eventBacklogThreshold})`
    );

    if (!this.skipWsConnection) {
      await this.setupProvider();
      await this.setupContracts();
      await this.setupRealtime();
    }

    // Perform initial candidate seeding
    await this.performInitialSeeding();

    // Start periodic seeding from subgraph if enabled
    if (config.useSubgraph && this.subgraphService) {
      this.startPeriodicSeeding();
    }

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Service started successfully');
  }

  /**
   * Stop the service and clean up
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Shutting down...');

    // Dump low HF tracker data if enabled
    if (this.lowHfTracker && config.lowHfDumpOnShutdown) {
      try {
        await this.lowHfTracker.dumpToFile();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Failed to dump low HF tracker data:', err);
      }
    }

    // Stop low HF tracker
    if (this.lowHfTracker) {
      this.lowHfTracker.stop();
    }

    // Clear timers
    if (this.seedTimer) clearInterval(this.seedTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pendingBlockTimer) clearInterval(this.pendingBlockTimer);
    if (this.runWatchdogTimer) clearTimeout(this.runWatchdogTimer);
    if (this.wsHeartbeatTimer) clearTimeout(this.wsHeartbeatTimer);
    if (this.pricePollingTimer) clearInterval(this.pricePollingTimer);

    // Clear event batch timers
    for (const [, batch] of this.eventBatchQueue) {
      clearTimeout(batch.timer);
    }
    this.eventBatchQueue.clear();
    this.eventBatchesPerBlock.clear();
    
    // Clear price trigger debounce timers
    for (const [, timer] of this.priceTriggerDebounceTimers) {
      clearTimeout(timer);
    }
    this.priceTriggerDebounceTimers.clear();

    // Remove all event listeners
    if (this.provider) {
      try {
        this.provider.removeAllListeners();
      } catch (err) {
        // Ignore errors during cleanup
      }
    }

    // Destroy provider
    if (this.provider) {
      try {
        if (this.provider instanceof WebSocketProvider) {
          await this.provider.destroy();
        }
      } catch (err) {
        // Ignore errors during destroy
      }
    }

    // Clear candidates
    this.candidateManager.clear();

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Shutdown complete');
  }

  /**
   * Setup WebSocket or HTTP provider
   */
  private async setupProvider(): Promise<void> {
    let wsUrl: string | undefined;

    if (config.useFlashblocks && config.flashblocksWsUrl) {
      wsUrl = config.flashblocksWsUrl;
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Using Flashblocks WebSocket');
    } else if (config.wsRpcUrl) {
      wsUrl = config.wsRpcUrl;
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Using standard WebSocket');
    } else {
      throw new Error('[realtime-hf] No WS_RPC_URL configured. Set WS_RPC_URL environment variable.');
    }

    try {
      this.provider = new WebSocketProvider(wsUrl);

      // Add error handler
      this.provider.on('error', (error: Error) => {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Provider error:', error.message);
        this.handleDisconnect();
      });

      // Wait for provider to be ready
      await this.provider.ready;
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] WebSocket provider connected');
      this.reconnectAttempts = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Failed to setup provider:', err);
      throw err;
    }
    
    // Setup HTTP provider for eth_call operations based on ETH_CALL_TRANSPORT config
    const transport = config.ethCallTransport;
    if (transport === 'HTTP') {
      // Route eth_call through HTTP provider
      const httpUrl = config.rpcUrl || wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      if (!httpUrl) {
        throw new Error('[realtime-hf] No RPC_URL configured for HTTP eth_call transport');
      }
      
      this.httpProvider = new JsonRpcProvider(httpUrl);
      await this.httpProvider.ready;
      // eslint-disable-next-line no-console
      console.log(`[provider] ws_ready; using HTTP for eth_call operations; WS reserved for subscriptions (url=${httpUrl.substring(0, 50)}...)`);
    } else {
      // Use WebSocket for eth_call (legacy behavior)
      this.httpProvider = null;
      // eslint-disable-next-line no-console
      console.log('[provider] ws_ready; using WebSocket for eth_call operations');
    }
  }

  /**
   * Setup contract instances
   */
  private async setupContracts(): Promise<void> {
    if (!this.provider) {
      throw new Error('[realtime-hf] Provider not initialized');
    }

    this.multicall3 = new Contract(config.multicall3Address, MULTICALL3_ABI, this.provider);
    this.aavePool = new Contract(config.aavePool, AAVE_POOL_ABI, this.provider);
    
    // Setup HTTP multicall3 contract if HTTP transport is enabled
    if (this.httpProvider) {
      this.multicall3Http = new Contract(config.multicall3Address, MULTICALL3_ABI, this.httpProvider);
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Multicall3 HTTP instance created for eth_call operations');
    }
    
    // Initialize MicroVerifier for fast-path verification
    if (config.microVerifyEnabled) {
      const { MicroVerifier } = await import('./MicroVerifier.js');
      this.microVerifier = new MicroVerifier(this.aavePool, this.microVerifyCache);
      // eslint-disable-next-line no-console
      console.log(
        `[realtime-hf] MicroVerifier enabled: maxPerBlock=${config.microVerifyMaxPerBlock} ` +
        `intervalMs=${config.microVerifyIntervalMs} nearThresholdBandBps=${config.nearThresholdBandBps} ` +
        `cacheTtlMs=${config.microVerifyCacheTtlMs}`
      );
    }

    // Setup optional secondary provider for head-check fallback (Goal 5)
    if (config.secondaryHeadRpcUrl) {
      try {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Initializing secondary provider for fallback...');
        this.secondaryProvider = new JsonRpcProvider(config.secondaryHeadRpcUrl);
        this.secondaryMulticall3 = new Contract(config.multicall3Address, MULTICALL3_ABI, this.secondaryProvider);
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Secondary provider initialized');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[realtime-hf] Failed to initialize secondary provider:', err);
        this.secondaryProvider = null;
        this.secondaryMulticall3 = null;
      }
    }

    // Verify contracts exist
    try {
      const multicallCode = await this.provider.getCode(config.multicall3Address);
      const aavePoolCode = await this.provider.getCode(config.aavePool);

      if (multicallCode === '0x') {
        throw new Error(`Multicall3 not found at ${config.multicall3Address}`);
      }
      if (aavePoolCode === '0x') {
        throw new Error(`Aave Pool not found at ${config.aavePool}`);
      }

      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Contracts verified');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Contract verification failed:', err);
      throw err;
    }
  }

  /**
   * Setup real-time event listeners using native ethers v6 providers
   */
  private async setupRealtime(): Promise<void> {
    if (!this.provider) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] No provider, skipping real-time setup');
      return;
    }

    try {
      // 1. Setup block listener for canonical rechecks
      this.provider.on('block', (blockNumber: number) => {
        if (this.isShuttingDown) return;
        try {
          this.handleNewBlock(blockNumber).catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Error handling block:', err);
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Error in block listener:', err);
        }
      });
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Subscribed (ethers) to block listener');

      // 2. Setup Aave Pool log listener
      // Get all registered event topics from EventRegistry
      const aaveTopics = eventRegistry.getAllTopics().filter(topic => {
        const entry = eventRegistry.get(topic);
        // Filter to only Aave events (exclude Chainlink)
        return entry && entry.name !== 'AnswerUpdated';
      });
      
      const aaveFilter = {
        address: config.aavePool,
        topics: [
          aaveTopics.length > 0 ? aaveTopics : [
            // Fallback to legacy event topics if registry is empty
            new Interface(AAVE_POOL_ABI).getEvent('Borrow')?.topicHash || '',
            new Interface(AAVE_POOL_ABI).getEvent('Repay')?.topicHash || '',
            new Interface(AAVE_POOL_ABI).getEvent('Supply')?.topicHash || '',
            new Interface(AAVE_POOL_ABI).getEvent('Withdraw')?.topicHash || ''
          ]
        ]
      };

      this.provider.on(aaveFilter, (log: EventLog) => {
        if (this.isShuttingDown) return;
        try {
          this.handleLog(log).catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Error handling Aave log:', err);
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Error in Aave log listener:', err);
        }
      });
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Subscribed (ethers) to Aave Pool logs');

      // 3. Optional: Auto-discover Chainlink feeds and setup BorrowersIndexService
      let feeds: Record<string, string> = {};
      
      if (config.autoDiscoverFeeds && this.provider) {
        try {
          // eslint-disable-next-line no-console
          console.log('[feed-discovery] Auto-discovery enabled, discovering reserves...');
          await this.performFeedDiscovery();
          
          // Build feeds map from discovered reserves
          feeds = FeedDiscoveryService.buildFeedsMap(this.discoveredReserves);
          
          // Merge with manual config if provided
          if (config.chainlinkFeeds) {
            feeds = FeedDiscoveryService.mergeFeedsWithConfig(feeds, config.chainlinkFeeds);
          }
          
          // eslint-disable-next-line no-console
          console.log(`[feed-discovery] Discovered ${Object.keys(feeds).length} Chainlink feeds`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[feed-discovery] Auto-discovery failed, falling back to manual config:', err);
          // Fall back to manual config
          if (config.chainlinkFeeds) {
            feeds = this.parseChainlinkFeeds(config.chainlinkFeeds);
          }
        }
      } else if (config.chainlinkFeeds) {
        // Use manual configuration only
        feeds = this.parseChainlinkFeeds(config.chainlinkFeeds);
      }
      
      // Setup Chainlink price feed listeners if we have any feeds (Goal A: NewTransmission only)
      if (Object.keys(feeds).length > 0) {
        // Get NewTransmission topic (OCR2) - ONLY event we subscribe to, to prevent duplicate scans
        const iface = new Interface(CHAINLINK_AGG_ABI);
        const newTransmissionTopic = iface.getEvent('NewTransmission')?.topicHash || '';
        
        const feedAddresses = Object.values(feeds);
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Setting up listeners for ${feedAddresses.length} feed(s): ` +
          `${Object.keys(feeds).join(',')} (events: NewTransmission only - AnswerUpdated disabled to prevent duplicates)`
        );
        
        for (const [token, feedAddress] of Object.entries(feeds)) {
          // Build reverse mapping for price trigger feature
          this.chainlinkFeedToSymbol.set(feedAddress.toLowerCase(), token);
          
          // Initialize per-asset state for polling
          this.priceAssetState.set(feedAddress.toLowerCase(), {
            lastAnswer: null,
            lastUpdatedAt: null,
            lastTriggerTs: 0,
            lastScanTs: 0,
            baselineAnswer: null
          });
          
          try {
            // Subscribe to NewTransmission ONLY (OCR2 Chainlink event)
            // AnswerUpdated subscription removed to prevent duplicate price-trigger scans (Goal A)
            const newTransmissionFilter = {
              address: feedAddress,
              topics: [newTransmissionTopic]
            };
            
            this.provider.on(newTransmissionFilter, (log: EventLog) => {
              if (this.isShuttingDown) return;
              try {
                this.handleLog(log).catch(err => {
                  // eslint-disable-next-line no-console
                  console.error(`[realtime-hf] Error handling NewTransmission for ${token}:`, err);
                });
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[realtime-hf] Error in NewTransmission listener for ${token}:`, err);
              }
            });
            
            // eslint-disable-next-line no-console
            console.log(`[realtime-hf] Subscribed to Chainlink feed for ${token} (NewTransmission only)`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[realtime-hf] Failed to subscribe to Chainlink feed for ${token}:`, err);
          }
        }
        
        // Start polling fallback if price trigger is enabled
        if (config.priceTriggerEnabled) {
          this.startPricePolling(feeds);
        }
      }

      // 4. Optional: Setup pending block polling when Flashblocks enabled
      if (config.useFlashblocks) {
        this.startPendingBlockPolling();
      }

      // 5. Start WebSocket heartbeat monitoring
      this.startWsHeartbeat();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Failed to setup real-time listeners:', err);
      throw err;
    }
  }

  /**
   * Start WebSocket heartbeat monitoring to detect stalled connections
   */
  private startWsHeartbeat(): void {
    if (!this.provider || !(this.provider instanceof WebSocketProvider)) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting WS heartbeat monitoring (interval=${config.wsHeartbeatMs}ms)`);
    
    this.lastWsActivity = Date.now();

    const heartbeatCheck = () => {
      if (this.isShuttingDown || !this.provider || this.isReconnecting) {
        return;
      }

      const now = Date.now();
      const timeSinceLastActivity = now - this.lastWsActivity;

      if (timeSinceLastActivity > config.wsHeartbeatMs) {
        // eslint-disable-next-line no-console
        console.warn(`[realtime-hf] WS heartbeat timeout: no activity for ${timeSinceLastActivity}ms, triggering reconnect`);
        wsReconnectsTotal.inc();
        this.handleWsStall();
      } else if (!this.isShuttingDown) {
        // Schedule next check only if not shutting down
        this.wsHeartbeatTimer = setTimeout(heartbeatCheck, config.wsHeartbeatMs);
      }
    };

    // Start initial check
    this.wsHeartbeatTimer = setTimeout(heartbeatCheck, config.wsHeartbeatMs);
  }

  /**
   * Handle WebSocket stall by reconnecting
   */
  private async handleWsStall(): Promise<void> {
    if (this.isReconnecting || this.isShuttingDown) {
      return;
    }

    this.isReconnecting = true;

    try {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Attempting WS reconnect due to heartbeat failure...');

      // Clean up existing provider
      if (this.provider) {
        try {
          this.provider.removeAllListeners();
          if (this.provider instanceof WebSocketProvider) {
            await this.provider.destroy();
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[realtime-hf] Error during provider cleanup:', err);
        }
      }

      // Re-setup provider and listeners
      await this.setupProvider();
      await this.setupContracts();
      await this.setupRealtime();

      // eslint-disable-next-line no-console
      console.log('[realtime-hf] ws_reconnected successfully after heartbeat failure');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] WS reconnect failed:', err);
      // Fall back to standard reconnect logic
      this.handleDisconnect();
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Handle new block notification - request head check via serialized queue
   */
  private async handleNewBlock(blockNumber: number): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] New block ${blockNumber}`);

    // Update WS activity timestamp
    this.lastWsActivity = Date.now();

    this.metrics.blocksReceived++;
    realtimeBlocksReceived.inc();
    
    // Notify MicroVerifier of new block (resets per-block counters)
    if (this.microVerifier) {
      this.microVerifier.onNewBlock(blockNumber);
    }
    
    // Periodic cache cleanup (every 10 blocks)
    if (blockNumber % 10 === 0) {
      this.microVerifyCache.cleanup();
    }

    // Request head check via serialization mechanism
    this.requestHeadCheck(blockNumber);
  }

  /**
   * Request a head check for a specific block number.
   * Coalesces multiple requests to the newest block with explicit skip logging.
   */
  private requestHeadCheck(blockNumber: number): void {
    const previousLatest = this.latestRequestedHeadBlock;
    
    // Update to newest requested block
    this.latestRequestedHeadBlock = Math.max(
      this.latestRequestedHeadBlock ?? blockNumber,
      blockNumber
    );

    // If already scanning and we're skipping blocks, log it explicitly (Goal 4)
    if (this.scanningHead && previousLatest !== null && blockNumber > previousLatest) {
      const skippedCount = blockNumber - previousLatest - 1;
      if (skippedCount > 0) {
        // eslint-disable-next-line no-console
        console.log(`[head-catchup] skipped ${skippedCount} stale blocks (latest=${blockNumber})`);
      }
      return;
    }

    // If already scanning but not skipping, just return
    if (this.scanningHead) {
      return;
    }

    // Start the run loop
    this.runHeadCheckLoop().catch(err => {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Error in head check loop:', err);
    });
  }

  /**
   * Run head-check loop that processes blocks serially, always using the newest requested block.
   */
  private async runHeadCheckLoop(): Promise<void> {
    this.scanningHead = true;

    try {
      while (this.latestRequestedHeadBlock !== null) {
        // Consume the newest requested block
        const runBlock = this.latestRequestedHeadBlock;
        this.latestRequestedHeadBlock = null;

        // Generate unique run ID
        this.currentRunId = `${Date.now()}-${runBlock}`;

        // Initialize progress tracking for this run
        this.lastProgressAt = Date.now();

        // Start run-level watchdog
        this.startRunWatchdog(runBlock);

        try {
          // Perform the head check for this block
          await this.performHeadCheck(runBlock, this.currentRunId);
        } finally {
          // Stop watchdog for this run
          this.stopRunWatchdog();
        }
      }
    } finally {
      this.scanningHead = false;
      this.currentRunId = null;
      this.lastProgressAt = null;
    }
  }

  /**
   * Start run-level watchdog to detect stalled runs
   */
  private startRunWatchdog(blockNumber: number): void {
    // Clear any existing watchdog
    this.stopRunWatchdog();

    const checkStall = () => {
      if (!this.lastProgressAt || this.isShuttingDown) {
        return;
      }

      const now = Date.now();
      const timeSinceProgress = now - this.lastProgressAt;

      if (timeSinceProgress > config.runStallAbortMs) {
        // eslint-disable-next-line no-console
        console.error(`[realtime-hf] run=${this.currentRunId} block=${blockNumber} stalled after ${timeSinceProgress}ms; aborting`);
        runAbortsTotal.inc();
        
        // Abort the run by pushing block back to queue and releasing lock
        this.abortCurrentRun(blockNumber);
      } else if (!this.isShuttingDown) {
        // Re-schedule check only if not shutting down
        this.runWatchdogTimer = setTimeout(checkStall, config.runStallAbortMs);
      }
    };

    this.runWatchdogTimer = setTimeout(checkStall, config.runStallAbortMs);
  }

  /**
   * Stop run-level watchdog
   */
  private stopRunWatchdog(): void {
    if (this.runWatchdogTimer) {
      clearTimeout(this.runWatchdogTimer);
      this.runWatchdogTimer = undefined;
    }
  }

  /**
   * Abort current run and recover cleanly
   */
  private abortCurrentRun(blockNumber: number): void {
    // Stop watchdog
    this.stopRunWatchdog();

    // If there's a pending block request that we're aborting, push it back
    if (blockNumber && this.latestRequestedHeadBlock !== blockNumber) {
      this.latestRequestedHeadBlock = blockNumber;
    }

    // Release the scanning lock to allow new runs
    this.scanningHead = false;
    this.currentRunId = null;
    this.lastProgressAt = null;

    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Run aborted, will retry on next tick`);

    // Restart the run loop if there's a pending block
    if (this.latestRequestedHeadBlock !== null) {
      this.runHeadCheckLoop().catch(err => {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Error restarting run loop after abort:', err);
      });
    }
  }

  /**
   * Perform a single head check for a specific block.
   * Per-run blockTag consistent reads: pass blockTag to all static calls
   */
  private async performHeadCheck(blockNumber: number, runId: string): Promise<void> {
    const startTime = Date.now();
    
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting head check run=${runId} block=${blockNumber} (blockTag=${blockNumber})`);

    // Clear per-block tracking for this block
    if (this.currentBlockNumber !== blockNumber) {
      this.seenUsersThisBlock.clear();
      this.currentBlockNumber = blockNumber;
      this.lastPriceCheckBlock = null;
      this.lastReserveCheckBlock = null;
      
      // Clear prestage cache every N blocks to prevent memory buildup
      const blocksSinceLastClear = blockNumber - this.prestageCacheLastClearBlock;
      if (blocksSinceLastClear >= this.PRESTAGE_CACHE_CLEAR_INTERVAL_BLOCKS) {
        const cacheSize = this.prestageCache.size;
        this.prestageCache.clear();
        this.prestageCacheLastClearBlock = blockNumber;
        
        if (cacheSize > 0) {
          console.log(
            `[predictive-prestage] cache cleared: entries=${cacheSize} ` +
            `block=${blockNumber} interval=${this.PRESTAGE_CACHE_CLEAR_INTERVAL_BLOCKS}`
          );
        }
      }
    }

    // Perform batch check on all candidates with blockTag
    const metrics = await this.checkAllCandidates('head', blockNumber);

    // On success, clear dirty sets (users have been checked)
    this.dirtyUsers.clear();
    this.dirtyReserves.clear();

    // Record metrics for adaptive page sizing
    const elapsed = Date.now() - startTime;
    this.recordHeadRunMetrics(elapsed, metrics.timeouts, metrics.avgLatency);
  }

  /**
   * Start pending block polling (Flashblocks mode)
   * Uses adaptive tick interval that increases during rate-limit bursts (Goal 4)
   */
  private startPendingBlockPolling(): void {
    if (!this.provider) return;

    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting pending block polling (tick=${this.currentPendingTickMs}ms)`);

    const pollFn = async () => {
      if (this.isShuttingDown || !this.provider) return;

      try {
        // Query pending block
        const pendingBlock = await this.provider.send('eth_getBlockByNumber', ['pending', false]);
        if (pendingBlock && pendingBlock.number) {
          // Trigger selective checks on low HF candidates when pending block changes
          await this.checkLowHFCandidates('price');
        }
      } catch (err) {
        // Silently ignore errors in pending block queries (expected for some providers)
      }

      // Re-schedule with current adaptive tick interval
      if (!this.isShuttingDown) {
        this.pendingBlockTimer = setTimeout(pollFn, this.currentPendingTickMs);
      }
    };

    // Start initial poll
    this.pendingBlockTimer = setTimeout(pollFn, this.currentPendingTickMs);
  }

  /**
   * Handle Aave Pool or Chainlink log event
   */
  private async handleLog(log: EventLog): Promise<void> {
    const logAddress = log.address.toLowerCase();

    // Check if it's an Aave Pool log
    if (logAddress === config.aavePool.toLowerCase()) {
      this.metrics.aaveLogsReceived++;
      realtimeAaveLogsReceived.inc();

      // Decode event using EventRegistry
      const decoded = eventRegistry.decode(log.topics as string[], log.data);
      
      if (decoded) {
        // Get block number for logging
        const blockNumber = typeof log.blockNumber === 'string' 
          ? parseInt(log.blockNumber, 16) 
          : log.blockNumber;

        // Log human-readable event details
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] ${formatDecodedEvent(decoded, blockNumber)}`);
        
        // Extract affected users
        const users = extractUserFromAaveEvent(decoded);
        
        // Extract reserve (asset) for context
        const reserve = extractReserveFromAaveEvent(decoded);
        
        // Invalidate micro-verify cache for affected users
        for (const user of users) {
          this.microVerifyCache.invalidateUser(user);
        }
        
        // Mark users and reserves as dirty for next head-check prioritization (Goal 2)
        for (const user of users) {
          this.dirtyUsers.add(user.toLowerCase());
          // Track reserve association for price trigger targeting
          if (reserve) {
            this.candidateManager.touchReserve(user.toLowerCase(), reserve);
          }
        }
        if (reserve) {
          this.dirtyReserves.add(reserve.toLowerCase());
        }
        
        // Handle based on event type
        if (decoded.name === 'LiquidationCall') {
          // Enhanced LiquidationCall tracking with candidate set classification
          const liquidatedUser = users[0];
          const candidate = this.candidateManager.get(liquidatedUser);
          const inSet = candidate !== undefined;
          const lastHF = candidate?.lastHF ?? null;
          
          // eslint-disable-next-line no-console
          console.log(
            `[realtime-hf] LiquidationCall detected: user=${liquidatedUser} ` +
            `in_set=${inSet} last_hf=${lastHF !== null ? lastHF.toFixed(4) : 'unknown'} ` +
            `block=${blockNumber}`
          );
          
          // Audit liquidation event if audit service is enabled
          if (this.liquidationAuditService) {
            const txHash = log.transactionHash || '';
            const candidatesTotal = this.candidateManager.size();
            
            // Async call - don't await to avoid blocking event processing
            this.liquidationAuditService.onLiquidationCall(
              decoded,
              blockNumber,
              txHash,
              (user: string) => this.candidateManager.get(user) !== undefined,
              candidatesTotal
            ).catch(err => {
              // eslint-disable-next-line no-console
              console.error('[realtime-hf] Liquidation audit failed:', err);
            });
          }
        }
        
        // For all user-affecting events, check for watched users first
        if (users.length > 0) {
          // Watched fast-path: immediately check watched users without batching
          if (this.watchSet) {
            // Partition users in single pass to avoid duplicate isWatched calls
            const watchedUsers: string[] = [];
            const unwatchedUsers: string[] = [];
            for (const user of users) {
              if (this.watchSet.isWatched(user)) {
                watchedUsers.push(user);
              } else {
                unwatchedUsers.push(user);
              }
            }
            
            // Immediately check watched users (no batching, no coalescing)
            for (const watchedUser of watchedUsers) {
              // Fire-and-forget to avoid blocking
              this.checkWatchedUserFastpath(watchedUser, blockNumber).catch(err => {
                // eslint-disable-next-line no-console
                console.error(`[watched-fastpath] Error checking watched user ${watchedUser}:`, err);
              });
            }
            
            // Enqueue unwatched users with normal batching
            if (unwatchedUsers.length > 0) {
              this.enqueueEventBatch(unwatchedUsers, reserve, blockNumber, decoded.name);
            }
          } else {
            // No watch set, use normal batching for all
            this.enqueueEventBatch(users, reserve, blockNumber, decoded.name);
          }
        } else {
          // ReserveDataUpdated, FlashLoan, etc. - may affect multiple users
          if (decoded.name === 'ReserveDataUpdated' && reserve) {
            const startReserveEvent = Date.now();
            
            // Extract index values from event args with validation
            const liquidityIndex = decoded.args.liquidityIndex;
            const variableBorrowIndex = decoded.args.variableBorrowIndex;
            
            // Validate indices are bigint before processing
            if (typeof liquidityIndex !== 'bigint' || typeof variableBorrowIndex !== 'bigint') {
              console.warn(
                `[reserve-index] Invalid index types for reserve=${reserve}: ` +
                `liquidityIndex=${typeof liquidityIndex}, variableBorrowIndex=${typeof variableBorrowIndex}`
              );
              return; // Skip processing this invalid event
            }
            
            // Get asset symbol for logging
            const assetSymbol = this.getAssetSymbolForReserve(reserve) || 'unknown';
            
            // Calculate index delta and determine if recheck is needed
            let shouldRecheck = true;
            if (this.reserveIndexTracker) {
              const delta = this.reserveIndexTracker.calculateDelta(
                reserve,
                liquidityIndex,
                variableBorrowIndex,
                assetSymbol
              );
              
              shouldRecheck = delta.shouldRecheck;
              
              // Update tracked indices for next comparison
              this.reserveIndexTracker.updateIndices(
                reserve,
                liquidityIndex,
                variableBorrowIndex,
                blockNumber
              );
              
              // Log delta info
              console.log(
                `[reserve-index-delta] reserve=${reserve.slice(0, 10)} asset=${assetSymbol} ` +
                `liquidityDelta=${delta.liquidityIndexDeltaBps.toFixed(2)}bps ` +
                `variableBorrowDelta=${delta.variableBorrowIndexDeltaBps.toFixed(2)}bps ` +
                `maxDelta=${delta.maxDeltaBps.toFixed(2)}bps ` +
                `shouldRecheck=${shouldRecheck} reason=${delta.reason}`
              );
            }
            
            // Skip recheck if delta is below threshold
            if (!shouldRecheck) {
              scansSuppressedByDeltaGate.inc({ asset: assetSymbol });
              console.log(
                `[reserve-skip] Skipping recheck for reserve=${reserve.slice(0, 10)} asset=${assetSymbol} ` +
                `(index delta below RESERVE_MIN_INDEX_DELTA_BPS=${config.reserveMinIndexDeltaBps}bps)`
              );
              return; // Skip the entire reserve recheck
            }
            
            // 1) Fetch impacted borrowers for this reserve via BorrowersIndexService
            let reserveBorrowers: string[] = [];
            if (this.borrowersIndex) {
              try {
                const allBorrowers = await this.borrowersIndex.getBorrowers(reserve);
                reserveBorrowers = allBorrowers.slice(0, config.reserveRecheckMaxBatch || 100);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[reserve-targeted] Failed to fetch borrowers for ${reserve}:`, err);
              }
            }
            
            // 2) Intersect with near-critical cache (users with HF < 1.02)
            const nearCritical = this.candidateManager.getAll()
              .filter(c => c.lastHF !== null && c.lastHF < 1.02)
              .map(c => c.address.toLowerCase());
            const nearCriticalSet = new Set(nearCritical);
            const targetedSubset = reserveBorrowers.filter(addr => nearCriticalSet.has(addr.toLowerCase()));
            
            // Record metrics for targeted subset
            subsetIntersectionSize.observe({ trigger: 'reserve' }, targetedSubset.length);
            
            // Watched fast-path: check watched users with exposure to this reserve
            if (this.watchSet) {
              const watchedUsers = this.watchSet.getWatchedUsers();
              const usersWithReserve = new Set(this.candidateManager.getUsersForReserve(reserve));
              
              // Find intersection: watched users who have this reserve
              const affectedWatched = watchedUsers.filter(user => usersWithReserve.has(user.toLowerCase()));
              
              // Immediately check affected watched users
              for (const watchedUser of affectedWatched) {
                this.checkWatchedUserFastpath(watchedUser, blockNumber).catch(err => {
                  // eslint-disable-next-line no-console
                  console.error(`[watched-fastpath] Error checking watched user ${watchedUser}:`, err);
                });
              }
            }
            
            // 3) Run mini-multicall subset BEFORE broad sweep (if we have a targeted subset)
            if (targetedSubset.length > 0) {
              // eslint-disable-next-line no-console
              console.log(
                `[reserve-targeted] ReserveDataUpdated reserve=${reserve} ` +
                `borrowers=${reserveBorrowers.length} nearCritical=${nearCritical.length} ` +
                `intersection=${targetedSubset.length} block=${blockNumber}`
              );
              
              // Run mini-multicall for targeted subset immediately (with reserve for dedup)
              await this.batchCheckCandidatesWithPending(targetedSubset, 'reserve', blockNumber, reserve);
              
              // Record latency from reserve event to first micro-verify
              const latencyMs = Date.now() - startReserveEvent;
              reserveEventToMicroVerifyMs.observe({ reserve: reserve.substring(0, 10) }, latencyMs);
              
              // eslint-disable-next-line no-console
              console.log(
                `[reserve-targeted] mini-multicall complete latency=${latencyMs}ms subset=${targetedSubset.length}`
              );
            }
            
            // Enqueue a batch check for low-HF candidates (broad sweep after targeted subset)
            this.enqueueEventBatch([], reserve, blockNumber, decoded.name);
          }
        }
      } else {
        // Fallback to legacy extraction if decode fails
        const userAddress = this.extractUserFromLog(log);
        if (userAddress) {
          // eslint-disable-next-line no-console
          console.log(`[realtime-hf] Aave event detected for user ${userAddress} (legacy)`);
          
          const blockNumber = typeof log.blockNumber === 'string' 
            ? parseInt(log.blockNumber, 16) 
            : log.blockNumber;
          
          // Enqueue with coalescing
          this.enqueueEventBatch([userAddress], null, blockNumber);
        }
      }
    } else {
      // Chainlink price update
      this.metrics.priceUpdatesReceived++;
      realtimePriceUpdatesReceived.inc();
      
      const feedAddress = log.address.toLowerCase();
      const currentBlock = typeof log.blockNumber === 'string' 
        ? parseInt(log.blockNumber, 16) 
        : log.blockNumber;
      
      // Try to decode Chainlink event for better logging and price extraction
      let decoded = eventRegistry.decode(log.topics as string[], log.data);
      
      // If eventRegistry decode fails, try manual decode for NewTransmission
      if (!decoded) {
        try {
          const iface = new Interface(CHAINLINK_AGG_ABI);
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed) {
            // Create a compatible DecodedEvent-like object
            decoded = { 
              name: parsed.name, 
              args: parsed.args as Record<string, unknown>,
              signature: parsed.signature
            };
          }
        } catch {
          // Ignore decode errors
        }
      }
      
      if (decoded && (decoded.name === 'AnswerUpdated' || decoded.name === 'NewTransmission')) {
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] Chainlink ${decoded.name} event (block=${currentBlock})`);
        
        // Handle price trigger logic if enabled
        if (config.priceTriggerEnabled) {
          await this.handleChainlinkEvent(feedAddress, decoded, currentBlock);
        }
      } else {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Chainlink price update detected');
      }
      
      // Per-block gating: prevent multiple price-triggered rechecks in same block (Goal 5)
      if (this.lastPriceCheckBlock === currentBlock) {
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] Price update - skipping recheck (already checked this block)`);
        return;
      }
      this.lastPriceCheckBlock = currentBlock;
      
      // Trigger selective rechecks on candidates with low HF
      await this.checkLowHFCandidates('price');
    }
  }

  /**
   * Extract user address from Aave Pool log
   */
  private extractUserFromLog(log: EventLog): string | null {
    try {
      const iface = new Interface(AAVE_POOL_ABI);
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      
      if (!parsed) return null;

      // Extract user based on event type
      switch (parsed.name) {
        case 'Borrow':
          return parsed.args.user || parsed.args.onBehalfOf || null;
        case 'Repay':
          return parsed.args.user || null;
        case 'Supply':
          return parsed.args.user || parsed.args.onBehalfOf || null;
        case 'Withdraw':
          return parsed.args.user || null;
        default:
          return null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime-hf] Failed to parse log:', err);
      return null;
    }
  }

  /**
   * Handle Chainlink event (AnswerUpdated or NewTransmission)
   * Extracts price and delegates to centralized price processing
   */
  private async handleChainlinkEvent(
    feedAddress: string,
    decoded: { name: string; args: Record<string, unknown> },
    blockNumber: number
  ): Promise<void> {
    try {
      let currentAnswer: bigint | undefined;
      
      // Extract price based on event type
      if (decoded.name === 'AnswerUpdated') {
        // AnswerUpdated: int256 indexed current
        currentAnswer = decoded.args.current as bigint | undefined;
      } else if (decoded.name === 'NewTransmission') {
        // NewTransmission: int192 answer (not indexed)
        currentAnswer = decoded.args.answer as bigint | undefined;
      }
      
      if (!currentAnswer || typeof currentAnswer !== 'bigint') {
        return;
      }
      
      // Process price update through centralized method
      await this.processPriceUpdate(feedAddress, currentAnswer, blockNumber, 'event');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[price-trigger] Error handling Chainlink event:', err);
    }
  }

  /**
   * Centralized price-trigger handling for both events and polling
   * Computes delta or cumulative drop vs baseline and triggers emergency scan when threshold crossed
   */
  private async processPriceUpdate(
    feedAddress: string,
    currentAnswer: bigint,
    blockNumber: number,
    source: 'event' | 'poll'
  ): Promise<void> {
    try {
      // Convert bigint to number safely
      const currentPrice = parseFloat(currentAnswer.toString());
      const rawSymbol = this.chainlinkFeedToSymbol.get(feedAddress) || feedAddress;
      const symbol = this.normalizeAssetSymbol(rawSymbol);
      
      // Increment per-asset price feed counter
      priceFeedEventsTotal.inc({ asset: symbol });
      
      // Check if this asset is in the monitored set (if filter is configured)
      if (this.priceMonitorAssets !== null && !this.priceMonitorAssets.has(symbol)) {
        return;
      }
      
      // Get or initialize per-asset state
      let state = this.priceAssetState.get(feedAddress);
      if (!state) {
        state = {
          lastAnswer: null,
          lastUpdatedAt: null,
          lastTriggerTs: 0,
          lastScanTs: 0,
          baselineAnswer: null
        };
        this.priceAssetState.set(feedAddress, state);
      }
      
      // Initialize baseline on first update
      if (state.baselineAnswer === null) {
        state.baselineAnswer = currentAnswer;
        state.lastAnswer = currentAnswer;
        state.lastUpdatedAt = Date.now();
        
        // Also update legacy maps for backward compatibility
        this.baselinePrices.set(feedAddress, currentPrice);
        this.lastSeenPrices.set(feedAddress, currentPrice);
        
        if (source === 'poll') {
          // eslint-disable-next-line no-console
          console.log(
            `[price-trigger] Initialized price tracking for ${symbol} via polling: ` +
            `mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'} baseline=${currentPrice}`
          );
        }
        return;
      }
      
      // Skip if no last answer (shouldn't happen after init, but guard)
      if (state.lastAnswer === null) {
        state.lastAnswer = currentAnswer;
        state.lastUpdatedAt = Date.now();
        this.lastSeenPrices.set(feedAddress, currentPrice);
        return;
      }
      
      // Calculate reference price based on mode
      const lastPrice = parseFloat(state.lastAnswer.toString());
      const baselinePrice = parseFloat(state.baselineAnswer.toString());
      const referencePrice = config.priceTriggerCumulative ? baselinePrice : lastPrice;
      
      // Update state
      state.lastAnswer = currentAnswer;
      state.lastUpdatedAt = Date.now();
      this.lastSeenPrices.set(feedAddress, currentPrice);
      
      // Guard against division by zero
      if (referencePrice <= 0) {
        // eslint-disable-next-line no-console
        console.warn(`[price-trigger] Invalid reference price (${referencePrice}) for ${symbol}, skipping trigger`);
        return;
      }
      
      // Calculate price change in basis points
      const priceDiff = currentPrice - referencePrice;
      const priceDiffPct = (priceDiff / referencePrice) * 10000; // basis points
      
      // Log price update at debug level
      if (source === 'poll' && Math.abs(priceDiffPct) > 1) {
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Poll update: ${symbol} ${lastPrice.toFixed(2)} → ${currentPrice.toFixed(2)} ` +
          `(${priceDiffPct >= 0 ? '+' : ''}${priceDiffPct.toFixed(2)}bps)`
        );
      }
      
      // Get per-asset threshold and debounce settings
      const assetDropBps = this.perAssetTriggerConfig?.getDropBps(symbol) ?? config.priceTriggerDropBps;
      const assetDebounceSec = this.perAssetTriggerConfig?.getDebounceSec(symbol) ?? config.priceTriggerDebounceSec;
      
      // Check if price dropped by threshold or more
      if (priceDiffPct >= -assetDropBps) {
        // Price increased or dropped less than threshold - no emergency scan
        return;
      }
      
      // Check debounce: prevent repeated scans on rapid ticks
      const now = Date.now();
      const debounceMs = assetDebounceSec * 1000;
      
      if (state.lastTriggerTs > 0 && (now - state.lastTriggerTs) < debounceMs) {
        const elapsedSec = Math.floor((now - state.lastTriggerTs) / 1000);
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Debounced (${source}): asset=${symbol} drop=${Math.abs(priceDiffPct).toFixed(2)}bps ` +
          `elapsed=${elapsedSec}s debounce=${assetDebounceSec}s ` +
          `mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'}`
        );
        return;
      }
      
      // Update last trigger time
      state.lastTriggerTs = now;
      this.lastPriceTriggerTime.set(symbol, now);
      
      // Reset baseline to current price after trigger (for cumulative mode)
      if (config.priceTriggerCumulative) {
        state.baselineAnswer = currentAnswer;
        this.baselinePrices.set(feedAddress, currentPrice);
      }
      
      // Price dropped significantly - trigger emergency scan
      const dropBps = Math.abs(priceDiffPct);
      // eslint-disable-next-line no-console
      console.log(
        `[price-trigger] Sharp price drop detected (${source}): asset=${symbol} ` +
        `drop=${dropBps.toFixed(2)}bps threshold=${assetDropBps}bps ` +
        `mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'} ` +
        `reference=${referencePrice.toFixed(2)} current=${currentPrice.toFixed(2)} ` +
        `block=${blockNumber}`
      );
      
      // Increment metric
      realtimePriceTriggersTotal.inc({ asset: symbol });
      
      // Select candidates for emergency scan
      const affectedUsers = this.selectCandidatesForEmergencyScan(symbol);
      
      if (affectedUsers.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`[price-trigger] No candidates associated with ${symbol}, skipping emergency scan`);
        return;
      }
      
      // Goal A: Debounce/jitter window to coalesce rapid same-block updates
      // Clear any existing timer for this symbol
      const existingTimer = this.priceTriggerDebounceTimers.get(symbol);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      
      // Add jitter to prevent synchronous execution across multiple symbols
      const jitterRange = config.priceTriggerJitterMaxMs - config.priceTriggerJitterMinMs;
      const jitterMs = config.priceTriggerJitterMinMs + Math.random() * jitterRange;
      
      // Schedule emergency scan with debounce
      const timer = setTimeout(() => {
        this.priceTriggerDebounceTimers.delete(symbol);
        this.executeEmergencyScan(symbol, affectedUsers, dropBps, blockNumber).catch(err => {
          // eslint-disable-next-line no-console
          console.error(`[price-trigger] Error in debounced emergency scan for ${symbol}:`, err);
        });
      }, jitterMs);
      
      this.priceTriggerDebounceTimers.set(symbol, timer);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[price-trigger] Error processing price update:', err);
    }
  }

  /**
   * Execute emergency scan for affected users
   * Enhanced with BorrowersIndex targeted subset and metrics
   */
  private async executeEmergencyScan(
    symbol: string,
    affectedUsers: string[],
    dropBps: number,
    blockNumber: number
  ): Promise<void> {
    try {
      const startReserveEvent = Date.now();
      
      // Goal A: Per-symbol per-block deduplication
      const lastProcessedBlock = this.lastProcessedBlockBySymbol.get(symbol);
      const dedupHit = lastProcessedBlock === blockNumber;
      
      if (dedupHit) {
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] scan suppressed: symbol=${symbol} block=${blockNumber} ` +
          `reason=already_processed_this_block dedup=hit`
        );
        return;
      }
      
      // Goal A: In-flight suppression - prevent concurrent scans for same symbol
      const inFlight = this.inFlightPriceTriggerBySymbol.get(symbol);
      if (inFlight) {
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] scan suppressed: symbol=${symbol} block=${blockNumber} ` +
          `reason=in_flight inflight_skip=true`
        );
        return;
      }
      
      // Goal: PRICE_TRIGGER_MIN_INTERVAL_SEC enforcement
      // Check if enough time has passed since last scan for this asset
      const feedAddressForInterval = this.discoveredReserves.find(
        r => r.symbol.toUpperCase() === symbol.toUpperCase()
      )?.chainlinkAggregator;
      
      if (feedAddressForInterval) {
        const state = this.priceAssetState.get(feedAddressForInterval);
        if (state && state.lastScanTs > 0) {
          const now = Date.now();
          const elapsedSec = (now - state.lastScanTs) / 1000;
          const minInterval = config.priceTriggerMinIntervalSec;
          
          if (elapsedSec < minInterval) {
            // eslint-disable-next-line no-console
            console.log(
              `[price-trigger] scan suppressed: symbol=${symbol} block=${blockNumber} ` +
              `reason=min_interval elapsed=${elapsedSec.toFixed(1)}s min=${minInterval}s`
            );
            return;
          }
        }
      }
      
      // Mark as in-flight
      this.inFlightPriceTriggerBySymbol.set(symbol, true);
      
      // Log scan scheduled
      // eslint-disable-next-line no-console
      console.log(
        `[price-trigger] scan scheduled: symbol=${symbol} block=${blockNumber} ` +
        `reason=NewTransmission dedup=miss inflight_skip=false drop=${dropBps.toFixed(2)}bps`
      );
      
      // Update last processed block for this symbol
      this.lastProcessedBlockBySymbol.set(symbol, blockNumber);
      
      // Increment metric
      realtimePriceEmergencyScansTotal.inc({ asset: symbol });
      
      // If BorrowersIndexService is available, fetch impacted borrowers and run targeted subset
      if (this.borrowersIndex) {
        // Find the reserve address for this symbol
        const reserve = this.discoveredReserves.find(
          r => r.symbol.toUpperCase() === symbol.toUpperCase()
        );
        
        if (reserve) {
          try {
            // Goal C: Near-band gating with BorrowersIndexService integration
            // 1) Fetch impacted borrowers for this reserve via BorrowersIndexService
            const allBorrowers = await this.borrowersIndex.getBorrowers(reserve.asset);
            const topN = Math.min(allBorrowers.length, config.priceTriggerReserveTopN);
            const reserveBorrowers = allBorrowers.slice(0, topN);
            
            // 2) If near-band gating is enabled, filter to users in critical HF window
            let nearBandFiltered: string[] = [];
            if (config.priceTriggerNearBandOnly) {
              const executionThreshold = config.executionHfThresholdBps / 10000; // e.g., 0.98
              const nearBandBps = config.priceTriggerNearBandBps; // e.g., 30 = 0.30%
              const nearBandUpper = executionThreshold + (nearBandBps / 10000);
              // Lower bound safety guard: prevent scanning deeply underwater positions
              const nearBandLower = Math.max(config.priceTriggerNearBandLowerBound, executionThreshold - 0.02);
              
              // Get all candidates with known HF
              const allCandidates = this.candidateManager.getAll()
                .filter(c => c.lastHF !== null && c.lastHF >= nearBandLower && c.lastHF <= nearBandUpper);
              
              const nearBandSet = new Set(allCandidates.map(c => c.address.toLowerCase()));
              nearBandFiltered = reserveBorrowers.filter(addr => nearBandSet.has(addr.toLowerCase()));
            } else {
              // Near-band gating disabled, use all reserveBorrowers
              nearBandFiltered = reserveBorrowers;
            }
            
            // 3) Cap at MAX_SCAN
            const targetedSubset = nearBandFiltered.slice(0, config.priceTriggerMaxScan);
            
            // Record metrics for targeted subset
            subsetIntersectionSize.observe({ trigger: 'price' }, targetedSubset.length);
            
            // Log near-band filtering results
            // eslint-disable-next-line no-console
            console.log(
              `[price-trigger] scan filtering: symbol=${symbol} block=${blockNumber} ` +
              `rawIndexCount=${allBorrowers.length} topN=${reserveBorrowers.length} ` +
              `nearBandCount=${nearBandFiltered.length} scannedCount=${targetedSubset.length}`
            );
            
            // 4) Run mini-multicall subset BEFORE broad sweep (if we have a targeted subset)
            if (targetedSubset.length > 0) {
              // eslint-disable-next-line no-console
              console.log(
                `[price-trigger-targeted] PriceShock ${symbol} drop=${dropBps.toFixed(2)}bps ` +
                `candidates=${targetedSubset.length} block=${blockNumber}`
              );
              
              // Run mini-multicall for targeted subset immediately (with symbol for stronger dedup)
              await this.batchCheckCandidatesWithPending(targetedSubset, 'price', blockNumber, symbol);
              
              // Record latency from price event to first micro-verify
              const latencyMs = Date.now() - startReserveEvent;
              reserveEventToMicroVerifyMs.observe({ reserve: reserve.asset.substring(0, 10) }, latencyMs);
              
              // Update lastScanTs for min interval enforcement (when targeted scan executes)
              const feedAddressForUpdate1 = this.discoveredReserves.find(
                r => r.symbol.toUpperCase() === symbol.toUpperCase()
              )?.chainlinkAggregator;
              
              if (feedAddressForUpdate1) {
                const state = this.priceAssetState.get(feedAddressForUpdate1);
                if (state) {
                  state.lastScanTs = Date.now();
                }
              }
              
              // eslint-disable-next-line no-console
              console.log(
                `[price-trigger-targeted] mini-multicall complete latency=${latencyMs}ms subset=${targetedSubset.length}`
              );
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[price-trigger-targeted] Failed to fetch borrowers for ${symbol}:`, err);
          }
        }
      }
      
      // Perform emergency scan with latency tracking on candidate set (broad sweep)
      // Note: This is a fallback that runs if BorrowersIndexService is not available
      if (!this.borrowersIndex && affectedUsers.length > 0) {
        const startTime = Date.now();
        const capped = affectedUsers.slice(0, config.priceTriggerMaxScan);
        await this.batchCheckCandidatesWithPending(capped, 'price', blockNumber, symbol);
        const latencyMs = Date.now() - startTime;
        emergencyScanLatency.observe(latencyMs);
        
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Emergency scan complete: asset=${symbol} ` +
          `candidates=${capped.length} latency=${latencyMs}ms trigger=price`
        );
      }
      
      // Update lastScanTs for min interval enforcement
      const feedAddressForUpdate2 = this.discoveredReserves.find(
        r => r.symbol.toUpperCase() === symbol.toUpperCase()
      )?.chainlinkAggregator;
      
      if (feedAddressForUpdate2) {
        const state = this.priceAssetState.get(feedAddressForUpdate2);
        if (state) {
          state.lastScanTs = Date.now();
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[price-trigger] Error handling price trigger:', err);
    } finally {
      // Goal A: Clear in-flight flag for this symbol
      this.inFlightPriceTriggerBySymbol.set(symbol, false);
    }
  }

  /**
   * Start periodic polling fallback for Chainlink price feeds
   * Runs even when events are active but respects debounce window
   */
  private startPricePolling(feeds: Record<string, string>): void {
    // Check for misconfiguration and apply guardrails
    const rawPollSec = config.priceTriggerPollSec;
    if (rawPollSec === 0) {
      // eslint-disable-next-line no-console
      console.log('[price-trigger] PRICE_TRIGGER_POLL_SEC=0: polling disabled (event-only mode)');
      return;
    }
    
    // Warn if value was clamped
    const rawEnvValue = process.env.PRICE_TRIGGER_POLL_SEC;
    if (rawEnvValue && Number(rawEnvValue) > 0 && Number(rawEnvValue) < 5) {
      // eslint-disable-next-line no-console
      console.warn(
        `[price-trigger] PRICE_TRIGGER_POLL_SEC=${rawEnvValue} is too low, clamped to 5s minimum ` +
        `(prevents tight loops and RPC saturation)`
      );
    }
    
    const pollIntervalMs = rawPollSec * 1000;
    
    // Filter out derived assets - they should not be polled at asset level
    const pollableFeeds: Record<string, string> = {};
    for (const [token, feedAddress] of Object.entries(feeds)) {
      // Skip if this is a derived asset (e.g., wstETH, weETH)
      if (this.priceService && this.priceService.isDerivedAsset(token)) {
        // eslint-disable-next-line no-console
        console.log(`[price-trigger] Skipping polling for derived asset: ${token} (event-only)`);
        continue;
      }
      pollableFeeds[token] = feedAddress;
    }
    
    // eslint-disable-next-line no-console
    console.log(
      `[price-trigger] Starting polling fallback: interval=${config.priceTriggerPollSec}s ` +
      `feeds=${Object.keys(pollableFeeds).length}/${Object.keys(feeds).length} (skipped ${Object.keys(feeds).length - Object.keys(pollableFeeds).length} derived)`
    );
    
    if (Object.keys(pollableFeeds).length === 0) {
      // eslint-disable-next-line no-console
      console.log('[price-trigger] No pollable feeds, polling disabled');
      return;
    }
    
    // Initial poll after a short delay
    setTimeout(() => {
      this.pollChainlinkFeeds(pollableFeeds).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[price-trigger] Error in initial poll:', err);
      });
    }, 2000);
    
    // Periodic polling
    this.pricePollingTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      
      this.pollChainlinkFeeds(pollableFeeds).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[price-trigger] Error in polling:', err);
      });
    }, pollIntervalMs);
  }

  /**
   * Poll latestRoundData for all configured feeds
   */
  private async pollChainlinkFeeds(feeds: Record<string, string>): Promise<void> {
    if (!this.provider) return;
    
    const currentBlock = await this.provider.getBlockNumber().catch(() => null);
    if (currentBlock === null) return;
    
    for (const [token, feedAddress] of Object.entries(feeds)) {
      try {
        // Skip if polling is disabled for this feed
        if (this.priceService && this.priceService.isFeedPollingDisabled(token)) {
          continue;
        }
        
        // Create contract instance for this feed
        const feedContract = new Contract(feedAddress, CHAINLINK_AGGREGATOR_ABI, this.provider);
        
        // Call latestRoundData
        const result = await feedContract.latestRoundData();
        const answer = result[1] as bigint; // answer is second return value
        
        if (answer && typeof answer === 'bigint') {
          // Process through centralized price update handler
          await this.processPriceUpdate(feedAddress.toLowerCase(), answer, currentBlock, 'poll');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[price-trigger] Polling error for ${token}:`, err);
      }
    }
  }

  /**
   * Select candidates for emergency scan based on asset symbol
   * @param assetSymbol Token symbol (e.g., 'ETH', 'USDC') - used to query reserve associations
   */
  private selectCandidatesForEmergencyScan(assetSymbol: string): string[] {
    // Get users associated with this reserve
    // Note: Reserve associations are tracked using lowercase addresses/symbols from Aave events
    const reserveUsers = this.candidateManager.getUsersForReserve(assetSymbol);
    
    if (reserveUsers.length > 0) {
      // Cap by configured max scan limit
      return reserveUsers.slice(0, config.priceTriggerMaxScan);
    }
    
    // Fallback: if no reserve mapping, check all candidates up to limit
    // Prioritize low HF candidates
    const allCandidates = this.candidateManager.getAll();
    const sorted = allCandidates
      .filter(c => c.lastHF !== null)
      .sort((a, b) => (a.lastHF || Infinity) - (b.lastHF || Infinity));
    
    return sorted
      .slice(0, config.priceTriggerMaxScan)
      .map(c => c.address);
  }

  /**
   * Perform initial candidate seeding on startup
   */
  private async performInitialSeeding(): Promise<void> {
    const seedBefore = this.candidateManager.size();
    let newCount = 0;

    // Priority 1: Subgraph seeding with SubgraphSeeder (if enabled)
    if (config.useSubgraph && this.subgraphService) {
      try {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Initial seeding from subgraph with SubgraphSeeder...');
        
        // Initialize SubgraphSeeder
        this.subgraphSeeder = new SubgraphSeeder({
          subgraphService: this.subgraphService,
          maxCandidates: config.candidateMax,
          pageSize: config.subgraphPageSize,
          politenessDelayMs: 100
        });
        
        // Perform comprehensive seeding
        const userAddresses = await this.subgraphSeeder.seed();
        this.candidateManager.addBulk(userAddresses);
        
        newCount = this.candidateManager.size() - seedBefore;
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] seed_source=subgraph_seeder candidates_total=${this.candidateManager.size()} new=${newCount}`);
        return; // Subgraph seeding is sufficient, skip on-chain backfill
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[realtime-hf] Subgraph seeding failed, falling back to on-chain backfill:', err);
      }
    }

    // Priority 2: On-chain backfill (default path when USE_SUBGRAPH=false)
    if (config.realtimeInitialBackfillEnabled) {
      try {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Initial seeding from on-chain backfill...');
        
        this.backfillService = new OnChainBackfillService();
        
        // Provider selection logic
        if (config.backfillRpcUrl) {
          // Use dedicated backfill RPC URL if provided
          // eslint-disable-next-line no-console
          console.log(`[realtime-hf] Using dedicated backfill RPC: ${config.backfillRpcUrl.substring(0, 20)}...`);
          await this.backfillService.initialize(config.backfillRpcUrl);
        } else if (this.provider) {
          // Reuse existing connected provider
          // eslint-disable-next-line no-console
          console.log('[realtime-hf] Reusing connected provider for backfill');
          await this.backfillService.initialize(this.provider);
        } else {
          throw new Error('No provider available for backfill (BACKFILL_RPC_URL not set and no WS provider)');
        }
        
        const result = await this.backfillService.backfill();
        
        // Add discovered users to candidate manager
        this.candidateManager.addBulk(result.users);
        newCount = this.candidateManager.size() - seedBefore;
        
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] seed_source=onchain_backfill candidates_total=${this.candidateManager.size()} new=${newCount}`);
        
        // Cleanup backfill service
        await this.backfillService.cleanup();
        this.backfillService = undefined;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] On-chain backfill failed:', err);
      }
    }

    if (newCount === 0) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] No initial candidates seeded, will rely on real-time events');
    }
  }

  /**
   * Check all candidates via Multicall3 batch with paging/rotation support and dirty-first prioritization
   * @param triggerType Type of trigger
   * @param blockTag Optional blockTag for consistent reads
   * @returns Metrics about the run
   */
  private async checkAllCandidates(triggerType: 'event' | 'head' | 'price', blockTag?: number): Promise<{ timeouts: number; avgLatency: number; candidates: number }> {
    const allAddresses = this.candidateManager.getAddresses();
    if (allAddresses.length === 0) {
      return { timeouts: 0, avgLatency: 0, candidates: 0 };
    }

    // Determine which addresses to check based on strategy
    let addressesToCheck: string[];
    
    if (config.headCheckPageStrategy === 'all') {
      // Check all candidates every head
      addressesToCheck = allAddresses;
    } else {
      // Hotset-first strategy: prioritize low-HF and triggered users, add small maintenance sweep
      const totalCandidates = allAddresses.length;
      const candidates = this.candidateManager.getAll();
      const addressSet = new Set(allAddresses);

      // 1. Low-HF addresses (HF < ALWAYS_INCLUDE_HF_BELOW) - highest priority
      // ENHANCEMENT: Risk-ordered head-start slice within low-HF candidates
      // Sort by HF ascending to surface most at-risk borrowers first
      let lowHfCandidates: typeof candidates = [];
      let headStartSlice: typeof candidates = [];
      let remainingLowHf: typeof candidates = [];
      
      try {
        const lowHfThreshold = config.alwaysIncludeHfBelow;
        const HEAD_START_SLICE_SIZE = 300; // Risk-ordered head-start slice (highest priority)
        
        lowHfCandidates = candidates
          .filter(c => c.lastHF !== null && c.lastHF < lowHfThreshold)
          .sort((a, b) => {
            // Sort by HF ascending (lower HF = higher priority)
            const hfA = a.lastHF ?? Infinity;
            const hfB = b.lastHF ?? Infinity;
            return hfA - hfB;
          });
        
        // === HEAD CRITICAL SLICE EARLY-BREAK ===
        // For the head-start slice, check for critical candidates needing immediate micro-verification
        const threshold = config.executionHfThresholdBps / 10000;
        const nearThresholdBand = config.nearThresholdBandBps / 10000;
        const upperBound = threshold + nearThresholdBand;
        
        // Identify critical candidates in the head-start slice
        const criticalCandidates = lowHfCandidates
          .slice(0, HEAD_START_SLICE_SIZE)
          .filter(c => {
            if (!c.lastHF) return false;
            // Critical if: projected HF < 1.0 OR in near-threshold band
            const inNearThreshold = c.lastHF >= threshold && c.lastHF <= upperBound;
            return inNearThreshold;
          });
        
        // Use HEAD_CRITICAL_BATCH_SIZE for near-threshold segment if configured
        const criticalBatchSize = config.headCriticalBatchSize || HEAD_START_SLICE_SIZE;
        
        // Take head-start slice for immediate processing
        headStartSlice = lowHfCandidates.slice(0, Math.min(criticalBatchSize, HEAD_START_SLICE_SIZE));
        remainingLowHf = lowHfCandidates.slice(headStartSlice.length);
        
        // Log head-start metrics
        if (headStartSlice.length > 0) {
          const headStartTime = Date.now();
          
          // Track head-start processing
          headstartProcessedTotal.inc(headStartSlice.length);
          
          // Log head-start composition
          const minHf = headStartSlice[0]?.lastHF?.toFixed(4) || 'N/A';
          const maxHf = headStartSlice[headStartSlice.length - 1]?.lastHF?.toFixed(4) || 'N/A';
          
          // eslint-disable-next-line no-console
          console.log(
            `[realtime-hf] head-start slice size=${headStartSlice.length} ` +
            `hf_range=[${minHf}, ${maxHf}] critical=${criticalCandidates.length} (risk-ordered)`
          );
          
          // Perform micro-verification on critical candidates if enabled
          if (this.microVerifier && config.microVerifyEnabled && criticalCandidates.length > 0) {
            const microVerifyCandidates = criticalCandidates.slice(0, config.microVerifyMaxPerBlock);
            
            // eslint-disable-next-line no-console
            console.log(
              `[realtime-hf] head-critical micro-verify starting: ${microVerifyCandidates.length} candidates`
            );
            
            for (const candidate of microVerifyCandidates) {
              const result = await this.microVerifier.verify({
                user: candidate.address,
                trigger: 'head_critical',
                currentHf: candidate.lastHF ?? undefined
              });
              
              // If HF < 1.0, it will be emitted by the regular batch check
              // The micro-verify just gives us an earlier read
              if (result && result.success && result.hf < 1.0) {
                // eslint-disable-next-line no-console
                console.log(
                  `[realtime-hf] head-critical hit user=${candidate.address.slice(0, 10)}... ` +
                  `hf=${result.hf.toFixed(4)} latency=${result.latencyMs}ms`
                );
              }
            }
          }
          
          // Track latency (will be measured after batch processing completes)
          const headStartLatency = Date.now() - headStartTime;
          headstartLatencyMs.observe(headStartLatency);
        }
      } catch (err) {
        // Fail-soft: disable head-start feature on error, continue with legacy ordering
        if (!this.headStartFeatureDisabled) {
          // eslint-disable-next-line no-console
          console.warn('[realtime-hf] head_loop_feature_disabled: Head-start ordering failed, falling back to legacy ordering', err);
          this.headStartFeatureDisabled = true;
        }
        // Reset to empty arrays to fall back to legacy behavior
        lowHfCandidates = candidates.filter(c => c.lastHF !== null && c.lastHF < config.alwaysIncludeHfBelow);
        headStartSlice = [];
        remainingLowHf = lowHfCandidates;
      }
      
      // Combine head-start + remaining low-HF for final processing
      const lowHfAddresses = [...headStartSlice, ...remainingLowHf].map(c => c.address);

      // 2. Dirty users - event/price-triggered addresses
      const dirtyFirst = Array.from(this.dirtyUsers).filter(addr => addressSet.has(addr));
      
      // 3. Maintenance sweep: small fixed-size sample from rotating window
      // Only add maintenance sweep if we have a reasonable cold set (total - hotset > maintenance size)
      const MAINTENANCE_SAMPLE_SIZE = 120; // Small fixed size for cache freshness
      const hotsetSize = new Set([...lowHfAddresses, ...dirtyFirst]).size;
      const coldSetSize = totalCandidates - hotsetSize;
      
      let maintenanceAddresses: string[] = [];
      if (coldSetSize > 0 && lowHfAddresses.length > 0) {
        // Cap maintenance sample to avoid large sweeps when lowHf count is high
        const maintenanceSize = Math.min(MAINTENANCE_SAMPLE_SIZE, coldSetSize);
        const startIdx = this.headCheckRotatingIndex % totalCandidates;
        const endIdx = Math.min(startIdx + maintenanceSize, totalCandidates);
        maintenanceAddresses = allAddresses.slice(startIdx, endIdx);
        
        // Wrap around if needed
        if (maintenanceAddresses.length < maintenanceSize && totalCandidates > maintenanceSize) {
          const remaining = maintenanceSize - maintenanceAddresses.length;
          const wrapAddresses = allAddresses.slice(0, Math.min(remaining, totalCandidates));
          maintenanceAddresses.push(...wrapAddresses);
        }
        
        // Update rotating index for next iteration
        this.headCheckRotatingIndex = (this.headCheckRotatingIndex + maintenanceSize) % totalCandidates;
      } else if (lowHfAddresses.length === 0) {
        // Fallback: if no low-HF users, use existing rotating window behavior
        const pageSize = config.headPageAdaptive ? this.currentDynamicPageSize : config.headCheckPageSize;
        const startIdx = this.headCheckRotatingIndex % totalCandidates;
        const endIdx = Math.min(startIdx + pageSize, totalCandidates);
        maintenanceAddresses = allAddresses.slice(startIdx, endIdx);
        
        if (maintenanceAddresses.length < pageSize && totalCandidates > pageSize) {
          const remaining = pageSize - maintenanceAddresses.length;
          const wrapAddresses = allAddresses.slice(0, Math.min(remaining, totalCandidates));
          maintenanceAddresses.push(...wrapAddresses);
        }
        
        this.headCheckRotatingIndex = (this.headCheckRotatingIndex + pageSize) % totalCandidates;
      }
      
      // Deduplicate in priority order: low-HF first, then dirty, then maintenance
      const seen = new Set<string>();
      addressesToCheck = [];
      
      for (const addr of lowHfAddresses) {
        if (!seen.has(addr)) {
          addressesToCheck.push(addr);
          seen.add(addr);
        }
      }
      
      for (const addr of dirtyFirst) {
        if (!seen.has(addr)) {
          addressesToCheck.push(addr);
          seen.add(addr);
        }
      }
      
      for (const addr of maintenanceAddresses) {
        if (!seen.has(addr)) {
          addressesToCheck.push(addr);
          seen.add(addr);
        }
      }
      
      // Log hotset-first stats
      const maintenanceCount = maintenanceAddresses.length;
      const mode = lowHfAddresses.length > 0 ? 'hotset-first' : 'rotating-fallback';
      // eslint-disable-next-line no-console
      console.log(
        `[realtime-hf] ${mode}: total=${addressesToCheck.length} ` +
        `lowHf=${lowHfAddresses.length} dirty=${dirtyFirst.length} maintenance=${maintenanceCount} ` +
        `candidates=${totalCandidates}`
      );
    }

    return await this.batchCheckCandidates(addressesToCheck, triggerType, blockTag);
  }

  /**
   * Check candidates with low HF (priority for price or event trigger)
   */
  private async checkLowHFCandidates(triggerType: 'event' | 'price', blockTag?: number): Promise<void> {
    const candidates = this.candidateManager.getAll();
    const lowHF = candidates
      .filter(c => c.lastHF !== null && c.lastHF < 1.1)
      .map(c => c.address);

    if (lowHF.length === 0) return;

    await this.batchCheckCandidates(lowHF, triggerType, blockTag);
  }

  /**
   * Check a single candidate
   */
  private async checkCandidate(address: string, triggerType: 'event' | 'head' | 'price', blockTag?: number): Promise<void> {
    await this.batchCheckCandidates([address], triggerType, blockTag);
  }

  /**
   * Watched fast-path: Single-user HF recompute for watched users
   * Bypasses batching and immediately publishes to fast-path if HF < 1.0
   */
  private async checkWatchedUserFastpath(address: string, blockNumber: number): Promise<void> {
    if (!this.multicall3 || !this.aavePool) return;

    const normalized = normalizeAddress(address);
    
    try {
      // Single-user mini-multicall (no batching, no hedging)
      const callData = this.aavePool.interface.encodeFunctionData('getUserAccountData', [normalized]);
      const call = {
        target: await this.aavePool.getAddress(),
        allowFailure: false,
        callData
      };

      const startTime = Date.now();
      const results = await this.multicall3.aggregate3.staticCall([call]);
      const latency = Date.now() - startTime;

      if (!results || results.length === 0) return;

      const result = results[0];
      if (!result.success) return;

      // Decode result
      const decoded = this.aavePool.interface.decodeFunctionResult('getUserAccountData', result.returnData);
      const healthFactorRaw = decoded.healthFactor;
      const totalDebtBase = decoded.totalDebtBase;

      // Skip if zero debt (not liquidatable)
      if (isZero(totalDebtBase)) return;

      const healthFactor = Number(healthFactorRaw) / 1e18;
      const hfRay = healthFactorRaw.toString();

      // eslint-disable-next-line no-console
      console.log(
        `[watched-fastpath-publish] user=${normalized} hf=${healthFactor.toFixed(4)} ` +
        `block=${blockNumber} latency=${latency}ms`
      );

      // Update user state for edge triggering
      const prevState = this.userStates.get(normalized);
      this.userStates.set(normalized, {
        status: healthFactor < 1.0 ? 'liq' : 'safe',
        lastHf: healthFactor,
        lastBlock: blockNumber
      });

      // Publish to fast-path if HF < execution threshold
      const executionThreshold = config.executionHfThresholdBps / 10000;
      if (healthFactor < executionThreshold && this.fastpathPublisher) {
        const published = await this.fastpathPublisher.publish({
          user: normalized,
          block: blockNumber,
          hfRay,
          ts: Date.now(),
          triggerType: 'watched_fastpath'
        });

        if (published) {
          // eslint-disable-next-line no-console
          console.log(`[watched-fastpath-attempt] user=${normalized} hf=${healthFactor.toFixed(4)} published=true`);
        }
      }

      // Emit liquidatable event if crossing below 1.0 (edge-triggered)
      const crossedBelow = prevState && prevState.status === 'safe' && healthFactor < 1.0;
      if (crossedBelow || (!prevState && healthFactor < 1.0)) {
        this.emit('liquidatable', {
          userAddress: normalized,
          healthFactor,
          blockNumber,
          triggerType: 'watched_fastpath',
          timestamp: Date.now()
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[watched-fastpath] Error checking user ${normalized}:`, err);
    }
  }

  /**
   * Detect if an error is a provider rate limit error (Goal 4)
   */
  private isRateLimitError(err: unknown): boolean {
    if (!err) return false;
    const errStr = String(err).toLowerCase();
    // Common rate limit error codes and messages
    return errStr.includes('-32005') || // RPS limit
           errStr.includes('rate limit') ||
           errStr.includes('too many requests') ||
           errStr.includes('429');
  }

  /**
   * Handle rate limit detection - adjust adaptive parameters (Goal 4)
   */
  private handleRateLimit(): void {
    this.consecutiveRateLimits++;
    
    // Adaptive chunking: reduce chunk size on repeated failures
    if (this.consecutiveRateLimits >= 2 && this.currentChunkSize > 50) {
      const newChunkSize = Math.max(50, Math.floor(this.currentChunkSize * 0.67));
      // eslint-disable-next-line no-console
      console.log(`[realtime-hf] Rate limit detected - reducing chunk size ${this.currentChunkSize} -> ${newChunkSize}`);
      this.currentChunkSize = newChunkSize;
    }
    
    // Adaptive flashblock tick: increase pending polling interval
    if (this.consecutiveRateLimits >= 2 && this.currentPendingTickMs < this.basePendingTickMs * 4) {
      const newTickMs = Math.min(this.basePendingTickMs * 4, this.currentPendingTickMs * 2);
      // eslint-disable-next-line no-console
      console.log(`[realtime-hf] Rate limit burst - increasing pending tick ${this.currentPendingTickMs}ms -> ${newTickMs}ms`);
      this.currentPendingTickMs = newTickMs;
    }
  }

  /**
   * Clear rate limit tracking when operations succeed (Goal 4)
   */
  private clearRateLimitTracking(): void {
    if (this.consecutiveRateLimits > 0) {
      this.consecutiveRateLimits = 0;
      
      // Restore chunk size gradually to configured value
      const targetChunkSize = config.multicallBatchSize;
      if (this.currentChunkSize < targetChunkSize) {
        this.currentChunkSize = Math.min(targetChunkSize, this.currentChunkSize + 10);
      }
      
      // Restore pending tick gradually
      if (this.currentPendingTickMs > this.basePendingTickMs) {
        this.currentPendingTickMs = Math.max(this.basePendingTickMs, Math.floor(this.currentPendingTickMs * 0.8));
      }
    }
  }

  /**
   * Get log prefix with current run and block for unambiguous tracking (Goal 4)
   */
  private getLogPrefix(): string {
    return `[realtime-hf] run=${this.currentRunId || 'unknown'} block=${this.currentBlockNumber || 'unknown'}`;
  }

  /**
   * Check borrowers of a specific reserve when it's updated or price changes
   */
  private async checkReserveBorrowers(reserveAddr: string, source: 'reserve' | 'price', blockTag?: number): Promise<void> {
    if (!this.borrowersIndex) {
      return;
    }

    try {
      // Get borrowers for this reserve
      const borrowers = await this.borrowersIndex.getBorrowers(reserveAddr);
      
      if (borrowers.length === 0) {
        return;
      }
      
      // Resolve symbol for logging and metrics
      const reserve = this.discoveredReserves.find(r => r.asset.toLowerCase() === reserveAddr.toLowerCase());
      const symbol = reserve?.symbol || reserveAddr.slice(0, 10);
      
      // === RESERVE FAST-SUBSET: Check near-threshold users first ===
      if (config.microVerifyEnabled && this.nearThresholdUsers.size > 0) {
        // Build intersection: near-threshold users who are also borrowers of this reserve
        const borrowerSet = new Set(borrowers.map(addr => addr.toLowerCase()));
        const fastSubset: string[] = [];
        
        for (const [user] of this.nearThresholdUsers) {
          if (borrowerSet.has(user.toLowerCase())) {
            fastSubset.push(user);
          }
        }
        
        // Limit to configured max
        const limitedSubset = fastSubset.slice(0, Math.min(fastSubset.length, config.reserveFastSubsetMax));
        
        if (limitedSubset.length > 0) {
          const startTime = Date.now();
          
          // Use micro-verify for fast subset (single calls)
          if (this.microVerifier && limitedSubset.length <= 10) {
            // eslint-disable-next-line no-console
            console.log(
              `[fast-lane] [reserve-fast-subset] asset=${symbol} size=${limitedSubset.length} ` +
              `via micro-verify (source=${source})`
            );
            
            const { reserveFastSubsetTotal } = await import('../metrics/index.js');
            reserveFastSubsetTotal.inc({ asset: symbol });
            
            for (const user of limitedSubset) {
              await this.microVerifier.verify({
                user,
                trigger: 'reserve_fast',
                currentHf: this.nearThresholdUsers.get(user)?.hf
              });
            }
          } else {
            // Use small multicall for larger fast subset
            // eslint-disable-next-line no-console
            console.log(
              `[fast-lane] [reserve-fast-subset] asset=${symbol} size=${limitedSubset.length} ` +
              `via multicall (source=${source})`
            );
            
            const { reserveFastSubsetTotal } = await import('../metrics/index.js');
            reserveFastSubsetTotal.inc({ asset: symbol });
            
            await this.batchCheckCandidatesWithPending(limitedSubset, source, blockTag);
          }
          
          const elapsedMs = Date.now() - startTime;
          
          // eslint-disable-next-line no-console
          console.log(
            `[fast-lane] [reserve-fast-subset] asset=${symbol} verifiedMs=${elapsedMs}`
          );
        }
      }

      // Select top N borrowers to recheck (randomized or by some priority)
      const topN = config.reserveRecheckTopN;
      const maxBatch = config.reserveRecheckMaxBatch;
      
      // Shuffle for fairness and take top N
      const shuffled = [...borrowers].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(topN, maxBatch, borrowers.length));
      
      // eslint-disable-next-line no-console
      console.log(
        `[reserve-recheck] Checking ${selected.length}/${borrowers.length} borrowers ` +
        `for reserve ${symbol} (source=${source}, block=${blockTag || 'latest'})`
      );
      
      // Increment metric
      reserveRechecksTotal.inc({ asset: symbol, source });
      
      // Perform batch HF check with optional pending verification
      await this.batchCheckCandidatesWithPending(selected, source, blockTag);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[reserve-recheck] Error checking reserve borrowers:`, err);
    }
  }

  /**
   * Batch check candidates with optional pending-state verification
   */
  private async batchCheckCandidatesWithPending(
    addresses: string[],
    triggerType: 'event' | 'head' | 'price' | 'reserve',
    blockTag?: number,
    symbolOrReserve?: string
  ): Promise<void> {
    // Determine if we should use pending verification
    const usePending = config.pendingVerifyEnabled && 
                       (triggerType === 'price' || triggerType === 'reserve') &&
                       !blockTag; // Only for real-time checks, not historical
    
    const effectiveBlockTag: number | 'pending' | undefined = usePending ? 'pending' : blockTag;
    
    // If using pending, log it with source information
    if (usePending) {
      // eslint-disable-next-line no-console
      console.log(`[pending-verify] source=${triggerType} users=${addresses.length} blockTag=pending`);
    }
    
    try {
      // Use existing batch check with effective block tag and symbol/reserve
      await this.batchCheckCandidates(addresses, triggerType, effectiveBlockTag, symbolOrReserve);
    } catch (err) {
      // Check if error is related to pending block not supported
      const errStr = String(err).toLowerCase();
      const errorCode = err instanceof Error && 'code' in err ? (err as any).code : 'unknown';
      
      if (usePending && (errStr.includes('pending') || errStr.includes('block tag') || errStr.includes('not supported'))) {
        // eslint-disable-next-line no-console
        console.warn(`[pending-verify] fallback-to-latest due to error-code=${errorCode}`);
        pendingVerifyErrorsTotal.inc();
        
        // Retry with latest (undefined means latest)
        await this.batchCheckCandidates(addresses, triggerType, blockTag, symbolOrReserve);
      } else {
        throw err;
      }
    }
  }

  /**
   * Enqueue event-driven batch check with coalescing
   * Fast-lane: bypass coalescing for critical liquidation events (ReserveDataUpdated)
   */
  private enqueueEventBatch(users: string[], reserve: string | null, blockNumber: number, eventName?: string): void {
    // Fast-lane: execute immediately for ReserveDataUpdated when fast-lane enabled
    const isFastLaneEvent = config.fastLaneEnabled && (eventName === 'ReserveDataUpdated' || !eventName);
    
    if (isFastLaneEvent && reserve) {
      // eslint-disable-next-line no-console
      console.log(`[fast-lane] ReserveDataUpdated reserve=${reserve} block=${blockNumber} - bypassing coalesce`);
      
      // Execute immediately without coalescing
      this.executeFastLaneBatch(users, reserve, blockNumber).catch(err => {
        // eslint-disable-next-line no-console
        console.error(`[fast-lane] Failed to execute fast-lane batch:`, err);
      });
      return;
    }

    // Standard path: use existing coalescing logic
    const batchKey = reserve ? `block-${blockNumber}-reserve-${reserve}` : `block-${blockNumber}-users`;

    // Get or create batch entry
    let batch = this.eventBatchQueue.get(batchKey);
    if (!batch) {
      // Create new batch with debounce timer
      batch = {
        users: new Set<string>(),
        reserves: new Set<string>(),
        timer: setTimeout(() => {
          this.executeEventBatch(batchKey).catch(err => {
            // eslint-disable-next-line no-console
            console.error(`[event-coalesce] Failed to execute batch ${batchKey}:`, err);
          });
        }, config.eventBatchCoalesceMs),
        blockNumber
      };
      this.eventBatchQueue.set(batchKey, batch);
    } else {
      // Reset timer to extend debounce window
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        this.executeEventBatch(batchKey).catch(err => {
          // eslint-disable-next-line no-console
          console.error(`[event-coalesce] Failed to execute batch ${batchKey}:`, err);
        });
      }, config.eventBatchCoalesceMs);
    }

    // Add users and reserve to batch
    for (const user of users) {
      batch.users.add(user.toLowerCase());
      this.candidateManager.add(user);
    }
    if (reserve) {
      batch.reserves.add(reserve.toLowerCase());
    }
  }

  /**
   * Execute fast-lane batch immediately (zero-delay)
   */
  private async executeFastLaneBatch(users: string[], reserve: string, blockNumber: number): Promise<void> {
    try {
      // Add users to candidate manager
      for (const user of users) {
        this.candidateManager.add(user.toLowerCase());
      }

      if (reserve && this.borrowersIndex) {
        // Use BorrowersIndexService to get affected borrowers
        const borrowers = await this.borrowersIndex.getBorrowers(reserve);
        const topN = config.reserveRecheckTopN;
        const maxBatch = config.reserveRecheckMaxBatch;
        
        // Shuffle for fairness and take top N
        const shuffled = [...borrowers].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, Math.min(topN, maxBatch, borrowers.length));
        
        if (selected.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`[fast-lane] [reserve-recheck] reserve=${reserve} borrowers=${selected.length}/${borrowers.length} block=${blockNumber}`);
          
          // Check with pending blockTag for immediate liquidation detection (with reserve for dedup)
          await this.batchCheckCandidatesWithPending(selected, 'reserve', blockNumber, reserve);
        }
      } else if (users.length > 0) {
        // Direct user check (without reserve since this is user-specific event)
        await this.batchCheckCandidatesWithPending(users, 'event', blockNumber);
      } else {
        // Fallback: check low-HF candidates
        await this.checkLowHFCandidates('event', blockNumber);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[fast-lane] Error executing fast-lane batch:', error);
    }
  }

  /**
   * Execute a coalesced event batch
   */
  private async executeEventBatch(batchKey: string): Promise<void> {
    const batch = this.eventBatchQueue.get(batchKey);
    if (!batch) return;

    // Remove from queue
    this.eventBatchQueue.delete(batchKey);

    const blockNumber = batch.blockNumber;
    const userCount = batch.users.size;
    const reserveCount = batch.reserves.size;

    // Check if we've hit the per-block limit
    const batchesThisBlock = this.eventBatchesPerBlock.get(blockNumber) || 0;
    if (batchesThisBlock >= config.eventBatchMaxPerBlock) {
      // eslint-disable-next-line no-console
      console.log(`[event-coalesce] skipped batch (block=${blockNumber}, users=${userCount}, reserves=${reserveCount}) - per-block limit reached (${config.eventBatchMaxPerBlock})`);
      this.recordEventBatchSkip();
      return;
    }

    // Check concurrency limit (use adaptive limit if enabled)
    const effectiveLimit = this.currentMaxEventBatches;
    if (this.runningEventBatches >= effectiveLimit) {
      // eslint-disable-next-line no-console
      console.log(`[event-coalesce] skipped batch (block=${blockNumber}, users=${userCount}, reserves=${reserveCount}) - concurrency limit reached (${effectiveLimit})`);
      this.recordEventBatchSkip();
      return;
    }

    // Increment counters
    this.eventBatchesPerBlock.set(blockNumber, batchesThisBlock + 1);
    this.runningEventBatches++;
    this.recordEventBatchExecuted();

    try {
      // eslint-disable-next-line no-console
      console.log(`[event-coalesce] executing batch (block=${blockNumber}, users=${userCount}, reserves=${reserveCount})`);

      // Execute checks for all users in the batch
      const usersArray = Array.from(batch.users);
      if (usersArray.length > 0) {
        await this.batchCheckCandidates(usersArray, 'event', blockNumber);
      } else if (reserveCount > 0) {
        // No specific users but reserve updated - use BorrowersIndexService if available
        // to target borrowers of the affected reserve
        if (this.borrowersIndex) {
          for (const reserveAddr of batch.reserves) {
            await this.checkReserveBorrowers(reserveAddr, 'reserve', blockNumber);
          }
        } else {
          // Fallback: check low-HF candidates
          await this.checkLowHFCandidates('event', blockNumber);
        }
      }
    } finally {
      this.runningEventBatches--;
      
      // Clean up old block counters (keep last 10 blocks)
      const oldestBlockToKeep = blockNumber - 10;
      for (const [block] of this.eventBatchesPerBlock) {
        if (block < oldestBlockToKeep) {
          this.eventBatchesPerBlock.delete(block);
        }
      }
    }
  }

  /**
   * Record head run metrics for adaptive page sizing
   */
  private recordHeadRunMetrics(elapsed: number, timeouts: number, avgLatency: number): void {
    if (!config.headPageAdaptive) return;

    // Keep rolling window of last N runs
    this.headRunHistory.push({ elapsed, timeouts, avgLatency });
    if (this.headRunHistory.length > this.ADAPTIVE_WINDOW_SIZE) {
      this.headRunHistory.shift();
    }

    // Perform adjustment if we have enough data (at least 25% of window)
    const minDataPoints = Math.ceil(this.ADAPTIVE_WINDOW_SIZE * 0.25);
    if (this.headRunHistory.length >= minDataPoints) {
      this.adjustDynamicPageSize();
    }
  }

  /**
   * Adjust dynamic page size based on recent head run metrics
   */
  private adjustDynamicPageSize(): void {
    if (!config.headPageAdaptive) return;

    const windowSize = this.headRunHistory.length;
    if (windowSize === 0) return;

    // Calculate averages over the window
    const avgElapsed = this.headRunHistory.reduce((sum, r) => sum + r.elapsed, 0) / windowSize;
    const totalTimeouts = this.headRunHistory.reduce((sum, r) => sum + r.timeouts, 0);
    const timeoutRate = totalTimeouts / windowSize;
    const timeoutPct = (timeoutRate * 100).toFixed(1);

    const prevPageSize = this.currentDynamicPageSize;
    const target = config.headPageTargetMs;
    const min = config.headPageMin;
    const max = config.headPageMax;

    // Decrease page size if avg elapsed > target OR timeout rate > threshold
    if (avgElapsed > target || timeoutRate > this.ADAPTIVE_TIMEOUT_THRESHOLD) {
      const newPageSize = Math.max(min, Math.floor(this.currentDynamicPageSize * this.ADAPTIVE_DECREASE_FACTOR));
      
      if (newPageSize !== prevPageSize) {
        this.currentDynamicPageSize = newPageSize;
        // eslint-disable-next-line no-console
        console.log(`[head-adapt] adjusted page size ${prevPageSize} -> ${newPageSize} (avg=${avgElapsed.toFixed(0)}ms, timeouts=${timeoutPct}%)`);
      }
    }
    // Increase page size if avg elapsed < 0.6 * target AND timeout rate == 0
    else if (avgElapsed < 0.6 * target && timeoutRate === 0) {
      const newPageSize = Math.min(max, Math.floor(this.currentDynamicPageSize * this.ADAPTIVE_INCREASE_FACTOR));
      
      if (newPageSize !== prevPageSize) {
        this.currentDynamicPageSize = newPageSize;
        // eslint-disable-next-line no-console
        console.log(`[head-adapt] adjusted page size ${prevPageSize} -> ${newPageSize} (avg=${avgElapsed.toFixed(0)}ms, timeouts=${timeoutPct}%)`);
      }
    }
  }

  /**
   * Record an event batch skip
   */
  private recordEventBatchSkip(): void {
    eventBatchesSkipped.inc();
    
    // Track in rolling window for adaptive adjustment
    if (config.adaptiveEventConcurrency) {
      this.eventBatchSkipHistory.push(1);
      if (this.eventBatchSkipHistory.length > this.EVENT_SKIP_WINDOW_SIZE) {
        this.eventBatchSkipHistory.shift();
      }
      this.adjustEventConcurrency();
    }
  }
  
  /**
   * Record an event batch execution
   */
  private recordEventBatchExecuted(): void {
    eventBatchesExecuted.inc();
    
    // Track in rolling window for adaptive adjustment
    if (config.adaptiveEventConcurrency) {
      this.eventBatchSkipHistory.push(0);
      if (this.eventBatchSkipHistory.length > this.EVENT_SKIP_WINDOW_SIZE) {
        this.eventBatchSkipHistory.shift();
      }
      this.adjustEventConcurrency();
    }
  }
  
  /**
   * Adjust event concurrency based on backlog and head latency
   */
  private adjustEventConcurrency(): void {
    if (!config.adaptiveEventConcurrency) return;
    
    const minLevel = config.maxParallelEventBatches;
    const maxLevel = config.maxParallelEventBatchesHigh;
    
    // Count skips in recent window
    const recentSkips = this.eventBatchSkipHistory.reduce((sum, val) => sum + val, 0);
    const backlogThreshold = config.eventBacklogThreshold;
    
    // Get head page latency from recent history
    const recentHeadLatency = this.headRunHistory.length > 0
      ? this.headRunHistory[this.headRunHistory.length - 1].elapsed
      : 0;
    const headTargetMs = config.headPageTargetMs;
    
    const prevLevel = this.currentMaxEventBatches;
    
    // Scale up if: backlog > threshold OR head latency < target
    if (recentSkips > backlogThreshold || (recentHeadLatency > 0 && recentHeadLatency < headTargetMs)) {
      this.currentMaxEventBatches = Math.min(maxLevel, this.currentMaxEventBatches + 1);
    }
    // Scale down if: no backlog and head latency approaching or exceeding target
    else if (recentSkips === 0 && recentHeadLatency > headTargetMs * 0.8) {
      this.currentMaxEventBatches = Math.max(minLevel, this.currentMaxEventBatches - 1);
    }
    
    if (this.currentMaxEventBatches !== prevLevel) {
      // eslint-disable-next-line no-console
      console.log(
        `[event-adapt] adjusted concurrency ${prevLevel} -> ${this.currentMaxEventBatches} ` +
        `(recentSkips=${recentSkips}, headLatency=${recentHeadLatency.toFixed(0)}ms)`
      );
    }
    
    // Update metrics
    eventConcurrencyLevel.set(this.currentMaxEventBatches);
    eventConcurrencyLevelHistogram.observe(this.currentMaxEventBatches);
  }

  /**
   * Execute a promise with a hard timeout
   * Properly cleans up the timeout to prevent leaks
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutError: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
    });

    return Promise.race([
      promise.then(result => {
        clearTimeout(timeoutId);
        return result;
      }),
      timeoutPromise
    ]).catch(err => {
      clearTimeout(timeoutId);
      throw err;
    });
  }

  /**
   * Execute a single chunk with timeout, hedging, and retry logic
   */
  private async executeChunkWithTimeout(
    chunk: Array<{ target: string; allowFailure: boolean; callData: string }>,
    overrides: Record<string, unknown>,
    chunkNum: number,
    totalChunks: number,
    logPrefix: string
  ): Promise<Array<{ success: boolean; returnData: string }> | null> {
    const maxAttempts = config.chunkRetryAttempts + 1; // +1 for initial attempt

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const startTime = Date.now();
      
      // Acquire in-flight slot if global rate limiting is enabled for price triggers
      const shouldLimitInFlight = config.priceTriggerGlobalRateLimit;
      let inFlightAcquired = false;
      
      if (shouldLimitInFlight) {
        inFlightAcquired = await this.globalRpcRateLimiter.acquireInFlight(5000);
        if (!inFlightAcquired) {
          // eslint-disable-next-line no-console
          console.warn(
            `${logPrefix} Chunk ${chunkNum} failed to acquire in-flight slot (max=${config.ethCallMaxInFlight})`
          );
          // Skip this chunk and continue with next attempt
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
            continue;
          }
          return null;
        }
      }

      try {
        let results: Array<{ success: boolean; returnData: string }>;
        let usedProvider: 'primary' | 'secondary' = 'primary';

        // Use HTTP multicall3 if available, otherwise fall back to WS multicall3
        const multicallToUse = this.multicall3Http || this.multicall3;
        
        // Implement hedging if configured and secondary provider available
        if (config.headCheckHedgeMs > 0 && this.secondaryMulticall3 && config.secondaryHeadRpcUrl) {
          // Race primary against hedged secondary
          const hedgeDelayMs = config.headCheckHedgeMs;
          
          const primaryPromise = multicallToUse!.aggregate3.staticCall(chunk, overrides);
          
          // Create hedge promise that only fires after delay
          const hedgePromise = new Promise<{ result: Array<{ success: boolean; returnData: string }>; provider: 'secondary' }>((resolve, reject) => {
            setTimeout(() => {
              if (!this.secondaryMulticall3) {
                reject(new Error('Secondary multicall not available'));
                return;
              }
              this.secondaryMulticall3.aggregate3.staticCall(chunk, overrides)
                .then(result => resolve({ result, provider: 'secondary' }))
                .catch(reject);
            }, hedgeDelayMs);
          });

          // Race primary (immediate) vs hedge (delayed)
          const winner = await Promise.race([
            primaryPromise.then(result => ({ result, provider: 'primary' as const })),
            hedgePromise
          ]);

          results = winner.result;
          usedProvider = winner.provider;

          if (usedProvider === 'secondary') {
            this.currentBatchMetrics.hedges++;
            this.currentBatchMetrics.secondaryUsed++;
            // eslint-disable-next-line no-console
            console.log(`${logPrefix} hedge fired after ${hedgeDelayMs}ms; winner=secondary`);
          } else {
            this.currentBatchMetrics.primaryUsed++;
          }
        } else {
          // No hedging, use primary only with timeout
          results = await this.withTimeout(
            multicallToUse!.aggregate3.staticCall(chunk, overrides),
            config.chunkTimeoutMs,
            `Chunk ${chunkNum} timeout after ${config.chunkTimeoutMs}ms`
          );
          this.currentBatchMetrics.primaryUsed++;
        }

        const duration = Date.now() - startTime;
        const durationSec = duration / 1000;
        chunkLatency.observe(durationSec);
        this.currentBatchMetrics.latencies.push(duration);

        // Update progress timestamp on successful chunk
        this.lastProgressAt = Date.now();

        this.clearRateLimitTracking();
        
        // Release in-flight slot on success
        if (shouldLimitInFlight && inFlightAcquired) {
          this.globalRpcRateLimiter.releaseInFlight();
        }
        
        // eslint-disable-next-line no-console
        console.log(`${logPrefix} Chunk ${chunkNum}/${totalChunks} complete (${chunk.length} calls, ${durationSec.toFixed(2)}s, provider=${usedProvider})`);
        return results;
      } catch (err) {
        // Release in-flight slot on error
        if (shouldLimitInFlight && inFlightAcquired) {
          this.globalRpcRateLimiter.releaseInFlight();
          inFlightAcquired = false; // Mark as released
        }
        
        const isTimeout = err instanceof Error && err.message.includes('timeout');

        if (isTimeout) {
          chunkTimeoutsTotal.inc();
          this.currentBatchMetrics.timeouts++;
          // eslint-disable-next-line no-console
          console.warn(`${logPrefix} timeout run=${this.currentRunId} block=${this.currentBlockNumber || 'unknown'} chunk ${chunkNum}/${totalChunks} after ${config.chunkTimeoutMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
        }

        if (this.isRateLimitError(err)) {
          this.handleRateLimit();
        }

        // Try secondary provider on first timeout or rate-limit if available (fallback, not hedging)
        // Note: Only use fallback mode when hedging is disabled (headCheckHedgeMs === 0)
        // to avoid double-requesting to secondary (once via hedge, once via fallback)
        if ((isTimeout || this.isRateLimitError(err)) && attempt === 0 && this.secondaryMulticall3 && config.headCheckHedgeMs === 0) {
          try {
            // eslint-disable-next-line no-console
            console.log(`${logPrefix} Chunk ${chunkNum} trying secondary provider (fallback)`);
            const secondaryStartTime = Date.now();
            
            const results = await this.withTimeout(
              this.secondaryMulticall3.aggregate3.staticCall(chunk, overrides),
              config.chunkTimeoutMs,
              `Chunk ${chunkNum} secondary timeout after ${config.chunkTimeoutMs}ms`
            );

            const secondaryDuration = Date.now() - secondaryStartTime;
            const secondaryDurationSec = secondaryDuration / 1000;
            chunkLatency.observe(secondaryDurationSec);
            this.currentBatchMetrics.latencies.push(secondaryDuration);
            this.currentBatchMetrics.secondaryUsed++;

            // Update progress timestamp on successful chunk
            this.lastProgressAt = Date.now();

            this.clearRateLimitTracking();
            
            // Release in-flight slot on success (secondary fallback path)
            if (shouldLimitInFlight && inFlightAcquired) {
              this.globalRpcRateLimiter.releaseInFlight();
              inFlightAcquired = false; // Mark as released
            }
            
            // eslint-disable-next-line no-console
            console.log(`${logPrefix} Chunk ${chunkNum}/${totalChunks} complete via secondary (${chunk.length} calls, ${secondaryDurationSec.toFixed(2)}s)`);
            return results;
          } catch (secondaryErr) {
            // eslint-disable-next-line no-console
            console.warn(`${logPrefix} Chunk ${chunkNum} secondary also failed`);
          }
        }

        // If not last attempt, do jittered backoff
        if (attempt < maxAttempts - 1) {
          const baseDelay = 1000 * Math.pow(2, attempt);
          const jitter = Math.random() * baseDelay * 0.3;
          const delayMs = Math.floor(baseDelay + jitter);
          // eslint-disable-next-line no-console
          console.log(`${logPrefix} Chunk ${chunkNum} retrying in ${delayMs}ms (attempt ${attempt + 2}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // All attempts failed
        if (isTimeout) {
          // eslint-disable-next-line no-console
          console.error(`${logPrefix} Chunk ${chunkNum} failed: all attempts timed out`);
        } else if (this.isRateLimitError(err)) {
          // eslint-disable-next-line no-console
          console.warn(`${logPrefix} Chunk ${chunkNum} failed: rate limit persists after retries`);
        } else {
          // eslint-disable-next-line no-console
          console.error(`${logPrefix} Chunk ${chunkNum} failed:`, err);
        }
        
        // Release in-flight slot if still held
        if (shouldLimitInFlight && inFlightAcquired) {
          this.globalRpcRateLimiter.releaseInFlight();
        }

        return null;
      }
    }

    return null;
  }

  /**
   * Perform read-only Multicall3 aggregate3 call with automatic chunking,
   * hard timeouts, retry logic, and optional secondary fallback
   * @param calls Array of multicall calls
   * @param chunkSize Optional chunk size override
   * @param blockTag Optional blockTag for consistent reads
   */
  private async multicallAggregate3ReadOnly(
    calls: Array<{ target: string; allowFailure: boolean; callData: string }>,
    chunkSize?: number,
    blockTag?: number | 'pending'
  ): Promise<Array<{ success: boolean; returnData: string }>> {
    const multicallToCheck = this.multicall3Http || this.multicall3;
    if (!multicallToCheck || !this.provider) {
      throw new Error('[realtime-hf] Multicall3 or provider not initialized');
    }

    // Use adaptive chunk size if not specified
    const effectiveChunkSize = chunkSize || this.currentChunkSize;
    
    // Log prefix for unambiguous run tracking
    const logPrefix = this.getLogPrefix();
    
    // Prepare overrides with blockTag if specified
    const overrides = blockTag ? { blockTag } : {};

    // If calls fit in single batch, execute with timeout and retry
    if (calls.length <= effectiveChunkSize) {
      const results = await this.executeChunkWithTimeout(
        calls,
        overrides,
        1,
        1,
        logPrefix
      );

      if (results) {
        return results;
      } else {
        // Chunk failed - return synthetic failures
        return calls.map(() => ({ success: false, returnData: '0x' }));
      }
    }

    // Split into chunks for large batches
    // eslint-disable-next-line no-console
    console.log(`${logPrefix} Chunking ${calls.length} calls into batches of ${effectiveChunkSize}`);
    
    const allResults: Array<{ success: boolean; returnData: string }> = [];
    const totalChunks = Math.ceil(calls.length / effectiveChunkSize);

    for (let i = 0; i < calls.length; i += effectiveChunkSize) {
      const chunk = calls.slice(i, i + effectiveChunkSize);
      const chunkNum = Math.floor(i / effectiveChunkSize) + 1;

      const results = await this.executeChunkWithTimeout(
        chunk,
        overrides,
        chunkNum,
        totalChunks,
        logPrefix
      );

      if (results) {
        allResults.push(...results);
      } else {
        // Chunk failed - add synthetic failures and continue
        const failedResults = chunk.map(() => ({ success: false, returnData: '0x' }));
        allResults.push(...failedResults);
      }
    }

    return allResults;
  }

  /**
   * Determine if a liquidatable event should be emitted based on edge-triggering and hysteresis.
   * Returns { shouldEmit: boolean, reason?: string }
   */
  private shouldEmit(userAddress: string, healthFactor: number, blockNumber: number): { shouldEmit: boolean; reason?: string } {
    const threshold = config.executionHfThresholdBps / 10000;
    const hysteresisBps = config.hysteresisBps;
    const hysteresisFactor = hysteresisBps / 10000; // e.g., 20 bps = 0.002 = 0.2%
    
    const state = this.userStates.get(userAddress);
    const lastBlock = this.lastEmitBlock.get(userAddress);
    
    // Never emit more than once per block per user
    if (lastBlock === blockNumber) {
      return { shouldEmit: false };
    }
    
    const isLiquidatable = healthFactor < threshold;
    
    if (!state) {
      // First time seeing this user
      if (isLiquidatable) {
        // User is liquidatable, emit and track
        this.userStates.set(userAddress, {
          status: 'liq',
          lastHf: healthFactor,
          lastBlock: blockNumber
        });
        return { shouldEmit: true, reason: 'safe_to_liq' };
      } else {
        // User is safe, just track
        this.userStates.set(userAddress, {
          status: 'safe',
          lastHf: healthFactor,
          lastBlock: blockNumber
        });
        return { shouldEmit: false };
      }
    }
    
    // Update state
    const previousStatus = state.status;
    const previousHf = state.lastHf;
    
    if (isLiquidatable) {
      state.status = 'liq';
      state.lastHf = healthFactor;
      state.lastBlock = blockNumber;
      
      if (previousStatus === 'safe') {
        // Transition from safe to liq (edge trigger)
        return { shouldEmit: true, reason: 'safe_to_liq' };
      } else {
        // Already liquidatable - check hysteresis
        const hfDiff = previousHf - healthFactor;
        const hfDiffPct = hfDiff / previousHf;
        
        if (hfDiffPct >= hysteresisFactor) {
          // HF worsened by at least hysteresis threshold
          return { shouldEmit: true, reason: 'worsened' };
        } else {
          // Still liquidatable but HF hasn't worsened enough
          return { shouldEmit: false };
        }
      }
    } else {
      // User is safe now
      state.status = 'safe';
      state.lastHf = healthFactor;
      state.lastBlock = blockNumber;
      
      return { shouldEmit: false };
    }
  }

  /**
   * Batch check multiple candidates using Multicall3
   * @param addresses - User addresses to check
   * @param triggerType - Type of trigger (event/head/price/reserve)
   * @param blockTag - Block number or 'pending'
   * @param symbolOrReserve - Optional asset symbol (WETH, USDC) or reserve address for stronger deduplication
   * @returns Metrics about the batch run
   */
  private async batchCheckCandidates(
    addresses: string[], 
    triggerType: 'event' | 'head' | 'price' | 'reserve', 
    blockTag?: number | 'pending',
    symbolOrReserve?: string
  ): Promise<{ timeouts: number; avgLatency: number; candidates: number }> {
    if (!this.multicall3 || !this.provider || addresses.length === 0) {
      return { timeouts: 0, avgLatency: 0, candidates: 0 };
    }

    // Try to acquire lock for this scan to prevent duplicate concurrent runs
    const blockNumber = (typeof blockTag === 'number' ? blockTag : undefined) || this.currentBlockNumber || 0;
    
    // Use ScanRegistry with stronger deduplication key (includes symbol/reserve)
    const scanKey = {
      triggerType: triggerType as 'price' | 'reserve' | 'head' | 'event',
      symbolOrReserve,
      blockTag: blockNumber
    };
    
    const lockAcquired = this.scanRegistry.acquire(scanKey);
    
    if (!lockAcquired) {
      // Another scan of the same type is already in-flight or recently completed
      // (metric already tracked by ScanRegistry)
      scansSuppressedByLock.inc({ trigger_type: triggerType }); // Keep legacy metric for compatibility
      return { timeouts: 0, avgLatency: 0, candidates: 0 };
    }
    
    // Apply global RPC rate limiting (with timeout to prevent blocking)
    const callCost = Math.ceil(addresses.length / config.multicallBatchSize);
    const rateLimitAcquired = await this.globalRpcRateLimiter.acquire({ 
      cost: callCost, 
      timeoutMs: 5000 // 5s timeout
    });
    
    if (!rateLimitAcquired) {
      // Rate limit exceeded - release scan lock and return
      this.scanRegistry.release(scanKey);
      console.log(
        `[rpc-rate-limit] Scan dropped: trigger=${triggerType} ` +
        `symbol=${symbolOrReserve || 'none'} block=${blockNumber} cost=${callCost}`
      );
      return { timeouts: 0, avgLatency: 0, candidates: 0 };
    }

    // Reset batch metrics for this run
    this.currentBatchMetrics = {
      timeouts: 0,
      latencies: [],
      hedges: 0,
      primaryUsed: 0,
      secondaryUsed: 0
    };

    try {
      const aavePoolInterface = new Interface(AAVE_POOL_ABI);
      const calls = addresses.map(addr => ({
        target: config.aavePool,
        allowFailure: true,
        callData: aavePoolInterface.encodeFunctionData('getUserAccountData', [addr])
      }));

      const results = await this.multicallAggregate3ReadOnly(calls, undefined, blockTag);
      const blockNumber = (typeof blockTag === 'number' ? blockTag : undefined) || await this.provider.getBlockNumber();
      let minHF: number | null = null;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const userAddress = addresses[i];

        if (result.success) {
          try {
            const decoded = aavePoolInterface.decodeFunctionResult('getUserAccountData', result.returnData);
            const totalCollateralBase = decoded[0]; // in base units (ETH equivalent, 8 decimals)
            const totalDebtBase = decoded[1]; // in base units (ETH equivalent, 8 decimals)
            const healthFactorRaw = decoded[5]; // 6th element
            const healthFactor = parseFloat(formatUnits(healthFactorRaw, 18));
            
            // Extract USD values (assuming 8 decimal base units)
            const totalCollateralUsd = parseFloat(formatUnits(totalCollateralBase, 8));
            const totalDebtUsd = parseFloat(formatUnits(totalDebtBase, 8));
            
            // Prune zero-debt users early
            if (isZero(totalDebtBase)) {
              candidatesPrunedZeroDebt.inc();
              continue;
            }
            
            // Prune tiny-debt users
            const minDebtUsd = config.minDebtUsd;
            if (totalDebtUsd < minDebtUsd) {
              candidatesPrunedTinyDebt.inc();
              continue;
            }

            this.candidateManager.updateHF(userAddress, healthFactor);
            this.metrics.healthChecksPerformed++;
            realtimeHealthChecksPerformed.inc();
            
            // Track for low HF recording (convert 'reserve' trigger to 'event' for lowHfTracker)
            if (this.lowHfTracker && healthFactor < config.alwaysIncludeHfBelow) {
              const lowHfTriggerType = (triggerType === 'reserve' ? 'event' : triggerType) as 'event' | 'head' | 'price';
              this.lowHfTracker.record(
                userAddress,
                healthFactor,
                blockNumber,
                lowHfTriggerType,
                totalCollateralUsd,
                totalDebtUsd
                // Note: reserves data not available without additional RPC calls
              );
            }

            // Track min HF (only for users with debt > 0, excluding infinity HFs)
            // Note: Zero-debt users are already filtered above, so no need to check again
            if (minHF === null || healthFactor < minHF) {
              minHF = healthFactor;
            }
            if (this.metrics.minHF === null || healthFactor < this.metrics.minHF) {
              this.metrics.minHF = healthFactor;
            }

            // Update Prometheus gauge for min HF
            if (this.metrics.minHF !== null) {
              realtimeMinHealthFactor.set(this.metrics.minHF);
            }

            // Per-block dedupe: emit at most once per user per block (Goal 3)
            if (this.seenUsersThisBlock.has(userAddress)) {
              // Already emitted for this user in this block - skip
              continue;
            }

            // Shadow execution: log would-be liquidation attempts (respects same dedupe rules)
            // Uses conservative estimates for debt/collateral assets and amounts
            const shadowCandidate: ShadowExecCandidate = {
              user: userAddress,
              healthFactor,
              blockTag: blockTag ?? blockNumber,
              // Use placeholder addresses - exact asset breakdown requires additional RPC calls
              debtAsset: '0x0000000000000000000000000000000000000000', // Placeholder
              collateralAsset: '0x0000000000000000000000000000000000000000', // Placeholder
              // Conservative estimates based on total values (8 decimals for base units)
              debtAmountWei: totalDebtBase,
              collateralAmountWei: totalCollateralBase
            };
            maybeShadowExecute(shadowCandidate);

            // Track HF delta and queue for pre-simulation if trending toward liquidation
            this.updateHfDeltaTracking(userAddress, healthFactor, blockNumber, totalDebtUsd);
            
            // === SPRINTER INTEGRATION HOOK ===
            // If SPRINTER_ENABLED and candidate has projHF < 1.0 with template ready,
            // schedule immediate micro-verify (when Sprinter is fully integrated)
            await this.maybeSprinterMicroVerify(userAddress, healthFactor, blockNumber, totalDebtUsd);
            
            // Track near-threshold users and schedule micro-verification if appropriate
            // Convert 'reserve' trigger to 'event' for maybeScheduleMicroVerify
            const microVerifyTriggerType = (triggerType === 'reserve' ? 'event' : triggerType) as 'event' | 'head' | 'price';
            await this.maybeScheduleMicroVerify(userAddress, healthFactor, blockNumber, totalDebtUsd, microVerifyTriggerType);

            // Check if we should emit based on edge-triggering and hysteresis
            const emitDecision = this.shouldEmit(userAddress, healthFactor, blockNumber);
            
            if (emitDecision.shouldEmit) {
              // Track that we've seen this user in this block
              this.seenUsersThisBlock.add(userAddress);
              
              // Format HF with infinity symbol for zero debt (though zero debt should be filtered)
              const hfDisplay = isZero(totalDebtBase) ? '∞' : healthFactor.toFixed(4);
              
              // Determine status label based on HF
              const threshold = config.executionHfThresholdBps / 10000;
              const statusLabel = healthFactor < threshold ? 'liquidatable' : 'near_threshold';
              
              // eslint-disable-next-line no-console
              console.log(
                `[realtime-hf] emit ${statusLabel} user=${userAddress} hf=${hfDisplay} ` +
                `reason=${emitDecision.reason} block=${blockNumber} valuation_source=aave_oracle`
              );

              // Track last emit block
              this.lastEmitBlock.set(userAddress, blockNumber);

              // Emit liquidatable event
              this.emit('liquidatable', {
                userAddress,
                healthFactor,
                blockNumber,
                triggerType,
                timestamp: Date.now()
              } as LiquidatableEvent);

              // Publish to fastpath channel if HF < 1.0 (use original ray value for precision)
              if (this.fastpathPublisher && healthFactor < 1.0) {
                this.fastpathPublisher.publish({
                  user: userAddress,
                  block: blockNumber,
                  hfRay: healthFactorRaw.toString(),
                  ts: Date.now(),
                  triggerType
                }).catch(err => {
                  console.error('[realtime-hf] Failed to publish fastpath event:', err);
                });
              }

              this.metrics.triggersProcessed++;
              // Convert 'reserve' trigger to 'event' for metrics compatibility
              const metricTriggerType = (triggerType === 'reserve' ? 'event' : triggerType) as 'event' | 'head' | 'price';
              realtimeTriggersProcessed.inc({ trigger_type: metricTriggerType });
              liquidatableEdgeTriggersTotal.inc({ reason: emitDecision.reason || 'unknown' });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[realtime-hf] Failed to decode result for ${userAddress}:`, err);
          }
        }
      }

      // Update candidate count gauge
      realtimeCandidateCount.set(this.candidateManager.size());

      // Calculate batch metrics
      const avgLatency = this.currentBatchMetrics.latencies.length > 0
        ? this.currentBatchMetrics.latencies.reduce((a, b) => a + b, 0) / this.currentBatchMetrics.latencies.length
        : 0;

      const totalProviderCalls = this.currentBatchMetrics.primaryUsed + this.currentBatchMetrics.secondaryUsed;
      const primaryShare = totalProviderCalls > 0 
        ? Math.round((this.currentBatchMetrics.primaryUsed / totalProviderCalls) * 100)
        : 100;

      // Enhanced logging with observability metrics (Goal 6)
      // eslint-disable-next-line no-console
      console.log(
        `[realtime-hf] Batch check complete: ${addresses.length} candidates, ` +
        `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'}, ` +
        `trigger=${triggerType}, ` +
        `subBatch=${config.multicallBatchSize}, ` +
        `hedges=${this.currentBatchMetrics.hedges}, ` +
        `timeouts=${this.currentBatchMetrics.timeouts}, ` +
        `primaryShare=${primaryShare}%`
      );

      return {
        timeouts: this.currentBatchMetrics.timeouts,
        avgLatency,
        candidates: addresses.length
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Batch check failed:', err);
      // Do not crash the service - continue runtime
      // The error is already logged above
      return { timeouts: 0, avgLatency: 0, candidates: addresses.length };
    } finally {
      // Always release the lock when done (success or error)
      const scanKey = {
        triggerType: triggerType as 'price' | 'reserve' | 'head' | 'event',
        symbolOrReserve,
        blockTag: blockNumber
      };
      this.scanRegistry.release(scanKey);
    }
  }

  /**
   * Start periodic seeding from subgraph with SubgraphSeeder (only when USE_SUBGRAPH=true)
   */
  private startPeriodicSeeding(): void {
    if (!config.useSubgraph || !this.subgraphSeeder) {
      return;
    }

    // Convert minutes to milliseconds for setInterval
    const SECONDS_PER_MINUTE = 60;
    const MILLISECONDS_PER_SECOND = 1000;
    const intervalMs = config.subgraphRefreshMinutes * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
    
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting periodic subgraph seeding (interval=${config.subgraphRefreshMinutes} minutes)`);
    
    // Initial seed (already done in performInitialSeeding, but log it)
    // No need to seed again here since performInitialSeeding just ran

    // Periodic seed with jitter
    this.seedTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      
      // Add jitter (±20% of interval)
      const jitter = Math.random() * 0.4 - 0.2; // -0.2 to +0.2
      const delay = Math.max(0, intervalMs * jitter);
      
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.seedFromSubgraphSeeder().catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Periodic seed failed:', err);
          });
        }
      }, delay);
    }, intervalMs);
  }

  /**
   * Seed candidates from subgraph using SubgraphSeeder
   */
  private async seedFromSubgraphSeeder(): Promise<void> {
    if (!this.subgraphSeeder || this.isShuttingDown) return;

    try {
      const seedBefore = this.candidateManager.size();

      // Perform comprehensive seeding with SubgraphSeeder
      const userAddresses = await this.subgraphSeeder.seed();
      
      if (userAddresses.length > 0) {
        this.candidateManager.addBulk(userAddresses);
        const newCount = this.candidateManager.size() - seedBefore;
        
        // Get metrics from seeder
        const metrics = this.subgraphSeeder.getMetrics();
        if (metrics) {
          // eslint-disable-next-line no-console
          console.log(
            `[realtime-hf] seed_source=subgraph_seeder ` +
            `candidates_total=${this.candidateManager.size()} ` +
            `new=${newCount} ` +
            `variable_debt=${metrics.variableDebtors} ` +
            `stable_debt=${metrics.stableDebtors} ` +
            `collateral=${metrics.collateralHolders}`
          );
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime-hf] SubgraphSeeder seed failed:', err);
    }
  }

  /**
   * Handle provider disconnect and attempt reconnect
   */
  private handleDisconnect(): void {
    if (this.isShuttingDown) return;

    this.reconnectAttempts++;
    this.metrics.reconnects++;
    realtimeReconnects.inc();

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Max reconnect attempts reached, giving up');
      this.stop();
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Attempting reconnect in ${backoffMs}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.isShuttingDown) return;
      
      this.setupProvider()
        .then(() => this.setupContracts())
        .then(() => this.setupRealtime())
        .then(() => {
          // eslint-disable-next-line no-console
          console.log('[realtime-hf] Reconnected successfully');
          this.reconnectAttempts = 0;
        })
        .catch(err => {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Reconnect failed:', err);
          this.handleDisconnect();
        });
    }, backoffMs);
  }

  /**
   * Parse Chainlink feeds from config string
   */
  private parseChainlinkFeeds(feedsStr: string): Record<string, string> {
    const feeds: Record<string, string> = {};
    const pairs = feedsStr.split(',');
    
    for (const pair of pairs) {
      const [token, address] = pair.split(':').map(s => s.trim());
      if (token && address) {
        feeds[token] = address;
      }
    }
    
    return feeds;
  }

  /**
   * Perform feed discovery and initialize BorrowersIndexService
   */
  private async performFeedDiscovery(): Promise<void> {
    if (!this.provider || !(this.provider instanceof JsonRpcProvider || this.provider instanceof WebSocketProvider)) {
      throw new Error('[feed-discovery] Provider not initialized');
    }

    // Initialize AaveDataService if not already done
    if (!this.aaveDataService) {
      this.aaveDataService = new AaveDataService(this.provider as JsonRpcProvider);
    }

    // Initialize FeedDiscoveryService
    this.feedDiscoveryService = new FeedDiscoveryService(
      this.provider as JsonRpcProvider,
      this.aaveDataService
    );

    // Discover reserves
    this.discoveredReserves = await this.feedDiscoveryService.discoverReserves({
      skipInactive: true,
      onlyBorrowEnabled: true
    });

    // Initialize BorrowersIndexService with discovered reserves (if enabled)
    if (config.borrowersIndexEnabled && this.discoveredReserves.length > 0) {
      try {
        // eslint-disable-next-line no-console
        console.log(`[borrowers-index] Initializing with ${this.discoveredReserves.length} reserves`);

        const reserves = this.discoveredReserves.map(r => ({
          asset: r.asset,
          symbol: r.symbol,
          variableDebtToken: r.variableDebtToken
        }));

        this.borrowersIndex = new BorrowersIndexService(
          this.provider as JsonRpcProvider,
          {
            mode: config.borrowersIndexMode as 'memory' | 'redis' | 'postgres',
            redisUrl: config.borrowersIndexRedisUrl,
            databaseUrl: config.databaseUrl,
            backfillBlocks: config.borrowersIndexBackfillBlocks,
            chunkSize: config.borrowersIndexChunkBlocks,
            maxUsersPerReserve: config.borrowersIndexMaxUsersPerReserve
          }
        );

        await this.borrowersIndex.initialize(reserves);
        // eslint-disable-next-line no-console
        console.log('[borrowers-index] Initialized successfully');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[borrowers-index] Failed to initialize:', err);
        // Continue without BorrowersIndexService
        this.borrowersIndex = undefined;
      }
    } else if (!config.borrowersIndexEnabled) {
      // eslint-disable-next-line no-console
      console.log('[borrowers-index] Disabled via BORROWERS_INDEX_ENABLED=false');
    }
  }

  /**
   * Track HF delta and queue for pre-simulation if trending toward liquidation
   */
  /**
   * Sprinter Integration Hook: Schedule micro-verification for pre-staged candidates.
   * This is a placeholder integration point for when Sprinter is fully implemented.
   */
  private async maybeSprinterMicroVerify(
    userAddress: string,
    healthFactor: number,
    blockNumber: number,
    debtUsd: number
  ): Promise<void> {
    // Check if Sprinter is enabled
    if (!config.sprinterEnabled || !this.microVerifier || !config.microVerifyEnabled) {
      return;
    }
    
    // Check if user has projected HF < 1.0 based on HF history
    const state = this.userStates.get(userAddress);
    if (!state?.hfHistory || state.hfHistory.length < 2) {
      return;
    }
    
    // Compute projection
    const oldest = state.hfHistory[0];
    const newest = state.hfHistory[state.hfHistory.length - 1];
    const deltaHf = newest.hf - oldest.hf;
    const deltaBlocks = newest.block - oldest.block;
    
    if (deltaBlocks === 0) return;
    
    const hfPerBlock = deltaHf / deltaBlocks;
    const projectedHf = healthFactor + hfPerBlock;
    
    // If projected HF < 1.0 and meets debt threshold, schedule micro-verify
    const prestageThreshold = config.prestageHfBps / 10000;
    if (projectedHf < 1.0 && healthFactor < prestageThreshold && debtUsd >= config.preSimMinDebtUsd) {
      // Schedule micro-verification
      const result = await this.microVerifier.verify({
        user: userAddress,
        trigger: 'sprinter',
        projectedHf,
        currentHf: healthFactor
      });
      
      if (result && result.success) {
        // eslint-disable-next-line no-console
        console.log(
          `[realtime-hf] [sprinter] micro-verify user=${userAddress.slice(0, 10)}... ` +
          `hf=${result.hf.toFixed(4)} projHf=${projectedHf.toFixed(4)} latency=${result.latencyMs}ms`
        );
        
        // If HF < 1.0, emit immediately (handled by regular flow)
        // The Sprinter would use the pre-staged template for instant execution
      }
    }
  }
  
  /**
   * Track near-threshold users and schedule micro-verification if conditions are met:
   * - Projection indicates projHF < 1.0, OR
   * - actualHF in [threshold, threshold + NEAR_THRESHOLD_BAND] and HF delta is negative (worsening)
   */
  private async maybeScheduleMicroVerify(
    userAddress: string,
    healthFactor: number,
    blockNumber: number,
    debtUsd: number,
    triggerType: 'event' | 'head' | 'price'
  ): Promise<void> {
    if (!this.microVerifier || !config.microVerifyEnabled) return;
    
    const threshold = config.executionHfThresholdBps / 10000; // e.g., 1.0000
    const nearThresholdBand = config.nearThresholdBandBps / 10000; // e.g., 0.0030 (30 bps)
    const upperBound = threshold + nearThresholdBand;
    
    // Get previous state for delta calculation
    const prevState = this.nearThresholdUsers.get(userAddress);
    const prevHf = prevState?.hf ?? healthFactor;
    const hfDelta = healthFactor - prevHf;
    const isWorsening = hfDelta < 0;
    
    // Update near-threshold tracking if in band
    if (healthFactor >= threshold && healthFactor <= upperBound) {
      this.nearThresholdUsers.set(userAddress, {
        hf: healthFactor,
        lastHf: prevHf,
        block: blockNumber,
        debtUsd
      });
    } else {
      // Remove from near-threshold set if outside band
      this.nearThresholdUsers.delete(userAddress);
    }
    
    // Check projection for sub-1.0 cross
    let shouldMicroVerify = false;
    let trigger: 'projection_cross' | 'near_threshold' = 'near_threshold';
    
    // Check if projection shows crossing below 1.0
    const state = this.userStates.get(userAddress);
    if (state?.hfHistory && state.hfHistory.length >= 2) {
      const oldest = state.hfHistory[0];
      const newest = state.hfHistory[state.hfHistory.length - 1];
      const deltaHf = newest.hf - oldest.hf;
      const deltaBlocks = newest.block - oldest.block;
      
      if (deltaBlocks > 0) {
        const hfPerBlock = deltaHf / deltaBlocks;
        const projectedHf = healthFactor + hfPerBlock;
        
        if (projectedHf < 1.0) {
          shouldMicroVerify = true;
          trigger = 'projection_cross';
        }
      }
    }
    
    // Check if in near-threshold band and worsening
    if (!shouldMicroVerify && healthFactor >= threshold && healthFactor <= upperBound && isWorsening) {
      shouldMicroVerify = true;
      trigger = 'near_threshold';
    }
    
    // Schedule micro-verification
    if (shouldMicroVerify) {
      const result = await this.microVerifier.verify({
        user: userAddress,
        trigger,
        projectedHf: trigger === 'projection_cross' ? healthFactor : undefined,
        currentHf: healthFactor
      });
      
      if (result && result.success) {
        // eslint-disable-next-line no-console
        console.log(
          `[realtime-hf] micro-verify user=${userAddress.slice(0, 10)}... ` +
          `hf=${result.hf.toFixed(4)} trigger=${trigger} latency=${result.latencyMs}ms`
        );
        
        // If HF < 1.0, emit immediately
        if (result.hf < 1.0 && !this.seenUsersThisBlock.has(userAddress)) {
          this.seenUsersThisBlock.add(userAddress);
          
          // eslint-disable-next-line no-console
          console.log(
            `[realtime-hf] emit liquidatable user=${userAddress} hf=${result.hf.toFixed(4)} ` +
            `reason=micro_verify_${trigger} block=${blockNumber}`
          );
          
          this.lastEmitBlock.set(userAddress, blockNumber);
          
          this.emit('liquidatable', {
            userAddress,
            healthFactor: result.hf,
            blockNumber,
            triggerType,
            timestamp: Date.now()
          } as LiquidatableEvent);
          
          // Publish to fastpath channel if HF < 1.0
          // Note: Using floating-point conversion here. For precise ray value,
          // MicroVerifier would need to return the raw BigInt value.
          if (this.fastpathPublisher && result.hf < 1.0) {
            this.fastpathPublisher.publish({
              user: userAddress,
              block: blockNumber,
              hfRay: (BigInt(Math.floor(result.hf * 1e18))).toString(),
              ts: Date.now(),
              triggerType: `micro_${trigger}`
            }).catch(err => {
              console.error('[realtime-hf] Failed to publish fastpath event:', err);
            });
          }
          
          this.metrics.triggersProcessed++;
          realtimeTriggersProcessed.inc({ trigger_type: `micro_${trigger}` });
          liquidatableEdgeTriggersTotal.inc({ reason: `micro_verify_${trigger}` });
        }
      }
    }
  }
  
  private updateHfDeltaTracking(userAddress: string, healthFactor: number, blockNumber: number, debtUsd: number): void {
    if (!config.preSimEnabled) return;

    const state = this.userStates.get(userAddress);
    if (!state) return;

    // Initialize history if needed
    if (!state.hfHistory) {
      state.hfHistory = [];
    }

    // Add current observation
    state.hfHistory.push({ hf: healthFactor, block: blockNumber });

    // Keep only last N observations
    if (state.hfHistory.length > this.PRE_SIM_HISTORY_WINDOW) {
      state.hfHistory.shift();
    }

    // Need at least 2 observations to compute delta
    if (state.hfHistory.length < 2) return;

    // Compute ΔHF/Δblock
    const oldest = state.hfHistory[0];
    const newest = state.hfHistory[state.hfHistory.length - 1];
    const deltaHf = newest.hf - oldest.hf;
    const deltaBlocks = newest.block - oldest.block;

    if (deltaBlocks === 0) return;

    const hfPerBlock = deltaHf / deltaBlocks;

    // Project HF for next block
    const projectedHf = healthFactor + hfPerBlock;

    // Check if projected HF < window and debt meets minimum
    if (projectedHf < config.preSimHfWindow && debtUsd >= config.preSimMinDebtUsd) {
      // Queue for pre-simulation
      this.preSimQueue.set(userAddress, {
        user: userAddress,
        projectedHf,
        debtUsd,
        timestamp: Date.now()
      });

      console.log(`[pre-sim] queued user=${userAddress.slice(0, 10)}... hf=${healthFactor.toFixed(4)} proj=${projectedHf.toFixed(4)} debt=$${debtUsd.toFixed(2)}`);
    }
  }

  /**
   * Ingest predictive candidates from PredictiveOrchestrator
   * Deduplicates by user+scenario per tick and pushes into warm/hot queue
   * When PREDICTIVE_MICRO_VERIFY_ENABLED and hfProjected < 1.0 + buffer: scheduleMicroVerify
   * When SPRINTER_ENABLED and hfProjected <= PRESTAGE_HF_BPS/10000: prestageFromPredictive
   */
  public ingestPredictiveCandidates(
    candidates: Array<{
      address: string;
      scenario: string;
      hfCurrent?: number;
      hfProjected: number;
      etaSec: number;
      totalDebtUsd: number;
    }>
  ): void {
    // Track ingested candidates to prevent duplicates in same tick
    const seenThisTick = new Set<string>();
    
    for (const candidate of candidates) {
      const key = `${candidate.address.toLowerCase()}_${candidate.scenario}`;
      
      // Deduplicate per tick
      if (seenThisTick.has(key)) {
        continue;
      }
      seenThisTick.add(key);
      
      // Calculate priority score: (1/etaSec) * (hfCurrent - hfProjected) * log(totalDebtUsd + 1)
      const hfCurrent = candidate.hfCurrent ?? 1.0;
      const hfDelta = Math.max(0, hfCurrent - candidate.hfProjected);
      const etaFactor = candidate.etaSec > 0 ? 1 / candidate.etaSec : 1;
      const debtFactor = Math.log10(Math.max(candidate.totalDebtUsd, 1) + 1);
      
      const priority = hfDelta * etaFactor * debtFactor;
      
      // Add to pre-sim queue with predictive_scenario reason
      const normalized = normalizeAddress(candidate.address);
      
      this.preSimQueue.set(normalized, {
        user: normalized,
        projectedHf: candidate.hfProjected,
        debtUsd: candidate.totalDebtUsd,
        timestamp: Date.now()
      });
      
      // Log ingested candidate
      console.log(
        `[predictive-ingest] queued user=${normalized.slice(0, 10)}... ` +
        `scenario=${candidate.scenario} priority=${priority.toFixed(4)} etaSec=${candidate.etaSec} ` +
        `hfProj=${candidate.hfProjected.toFixed(4)}`
      );
      
      // Notify liquidation audit service of predictive candidate (for race classification)
      if (this.liquidationAuditService) {
        this.liquidationAuditService.recordPredictiveCandidate(
          normalized,
          candidate.scenario,
          candidate.hfProjected
        );
      }

      // Schedule micro-verify if PREDICTIVE_MICRO_VERIFY_ENABLED and hfProjected < 1.0 + buffer
      if (config.predictiveMicroVerifyEnabled && this.microVerifier) {
        const microVerifyBuffer = config.nearThresholdBandBps / 10000; // Use near-threshold band as buffer
        const microVerifyThreshold = 1.0 + microVerifyBuffer;
        
        if (candidate.hfProjected < microVerifyThreshold) {
          // Respect per-block caps via canVerify
          if (this.microVerifier.canVerify(normalized)) {
            // Increment metric before scheduling (not after success)
            predictiveMicroVerifyScheduledTotal.inc({ scenario: candidate.scenario });
            
            // Fire-and-forget to avoid blocking ingestion
            this.microVerifier.verify({
              user: normalized,
              trigger: 'proj_cross',
              projectedHf: candidate.hfProjected,
              currentHf: candidate.hfCurrent
            }).then(result => {
              if (result && result.success) {
                console.log(
                  `[predictive-micro-verify] user=${normalized.slice(0, 10)}... ` +
                  `scenario=${candidate.scenario} hf=${result.hf.toFixed(4)} latency=${result.latencyMs}ms`
                );
              }
            }).catch(err => {
              console.error(`[predictive-micro-verify] Error:`, err);
              pendingVerifyErrorsTotal.inc();
            });
          }
        }
      }

      // Prestage if SPRINTER_ENABLED and hfProjected <= PRESTAGE_HF_BPS/10000
      if (config.sprinterEnabled && candidate.hfProjected <= config.prestageHfBps / 10000) {
        // Check if (user, scenario) already prestaged in current cycle
        const prestageKey = normalized.toLowerCase();
        const scenarios = this.prestageCache.get(prestageKey);
        
        if (scenarios?.has(candidate.scenario)) {
          // Already prestaged this (user, scenario) in current cycle - skip
          console.log(
            `[predictive-prestage] skipped: user=${normalized.slice(0, 10)}... ` +
            `scenario=${candidate.scenario} reason=already_prestaged_this_cycle`
          );
          return;
        }
        
        // Mark as prestaged in cache
        if (!scenarios) {
          this.prestageCache.set(prestageKey, new Set([candidate.scenario]));
        } else {
          scenarios.add(candidate.scenario);
        }
        
        // Call sprinterEngine.prestageFromPredictive with real debt/collateral data
        // Fire-and-forget to avoid blocking ingestion
        this.prestageFromPredictiveCandidateWithRealData(
          normalized,
          candidate.hfProjected,
          candidate.totalDebtUsd,
          candidate.scenario
        ).then(() => {
          predictivePrestagedTotal.inc({ scenario: candidate.scenario });
          console.log(
            `[predictive-prestage] user=${normalized.slice(0, 10)}... scenario=${candidate.scenario} ` +
            `hfProj=${candidate.hfProjected.toFixed(4)} prestaged`
          );
        }).catch(err => {
          console.error(`[predictive-prestage] Error:`, err);
        });
      }
    }
  }

  /**
   * Get pre-simulation queue (for testing/monitoring)
   */
  getPreSimQueue(): Map<string, PreSimQueueEntry> {
    return new Map(this.preSimQueue);
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      candidateCount: this.candidateManager.size(),
      lowestHFCandidate: this.candidateManager.getLowestHF(),
      preSimQueueSize: this.preSimQueue.size
    };
  }

  /**
   * Get candidate manager (for testing)
   */
  getCandidateManager(): CandidateManager {
    return this.candidateManager;
  }

  /**
   * Get low HF tracker (for API endpoints)
   */
  getLowHFTracker(): LowHFTracker | undefined {
    return this.lowHfTracker;
  }

  /**
   * Get AaveDataService (for predictive orchestrator integration)
   */
  getAaveDataService(): AaveDataService | undefined {
    return this.aaveDataService;
  }

  /**
   * Get current block number (for predictive orchestrator integration)
   */
  async getCurrentBlock(): Promise<number> {
    if (!this.provider) {
      return 0;
    }
    try {
      return await this.provider.getBlockNumber();
    } catch (err) {
      return this.currentBlockNumber || 0;
    }
  }

  /**
   * Schedule micro-verify for a predictive candidate
   * Called from PredictiveOrchestrator listener when shouldMicroVerify is true
   */
  async schedulePredictiveMicroVerify(
    userAddress: string,
    projectedHf: number,
    scenario: string
  ): Promise<void> {
    if (!this.microVerifier || !config.microVerifyEnabled) {
      return;
    }

    const normalized = normalizeAddress(userAddress);
    
    // Check if we can schedule this micro-verify
    if (!this.microVerifier.canVerify(normalized)) {
      return;
    }

    // Schedule the micro-verify
    const result = await this.microVerifier.verify({
      user: normalized,
      trigger: 'proj_cross',
      projectedHf: projectedHf
    });

    if (result && result.success) {
      // eslint-disable-next-line no-console
      console.log(
        `[predictive-micro-verify] user=${normalized.slice(0, 10)}... scenario=${scenario} ` +
        `hf=${result.hf.toFixed(4)} latencyMs=${result.latencyMs}`
      );
      
      // Update candidate manager with fresh HF
      this.candidateManager.add(normalized, result.hf);
    }
  }

  /**
   * Prestage a predictive candidate using SprinterEngine with REAL data
   * Fetches actual debt/collateral tokens and amounts from AaveDataService
   * Called from ingestPredictiveCandidates when SPRINTER_ENABLED
   */
  async prestageFromPredictiveCandidateWithRealData(
    userAddress: string,
    projectedHf: number,
    totalDebtUsd: number,
    scenario: string
  ): Promise<void> {
    const normalized = normalizeAddress(userAddress);
    
    // PREDICTIVE NEAR-BAND ONLY: Skip reserve fetch for users outside near band
    // This prevents unnecessary RPC calls for clearly safe users
    const executionThreshold = config.executionHfThresholdBps / 10000; // 0.98 default
    const nearBandBps = config.nearThresholdBandBps; // 30 bps default
    const alwaysIncludeBelow = config.alwaysIncludeHfBelow; // 1.10 default
    
    const nearBandUpperBound = Math.max(
      alwaysIncludeBelow,
      1.0 + nearBandBps / 10000
    );
    const nearBandLowerBound = config.hfPredCritical || (executionThreshold - 0.02);
    
    // Short-circuit if projected HF is outside near band
    if (projectedHf > nearBandUpperBound || projectedHf < nearBandLowerBound) {
      console.log(
        `[predictive-prestage] user=${normalized.slice(0, 10)}... scenario=${scenario} ` +
        `projHf=${projectedHf.toFixed(4)} (skipped: hf_not_near_band, bounds=[${nearBandLowerBound.toFixed(4)}, ${nearBandUpperBound.toFixed(4)}])`
      );
      return;
    }
    
    // Check if AaveDataService is available
    if (!this.aaveDataService || !this.aaveDataService.isInitialized()) {
      // eslint-disable-next-line no-console
      console.log(
        `[predictive-prestage] user=${normalized.slice(0, 10)}... scenario=${scenario} ` +
        `projHf=${projectedHf.toFixed(4)} debtUsd=${totalDebtUsd.toFixed(2)} ` +
        `(skipped: AaveDataService not initialized)`
      );
      return;
    }

    try {
      // Fetch user reserves from Aave Protocol Data Provider
      const userReserves = await this.aaveDataService.getAllUserReserves(normalized);
      
      // Find largest debt and collateral positions
      let largestDebt: { asset: string; amount: bigint; valueUsd: number } | null = null;
      let largestCollateral: { asset: string; amount: bigint; valueUsd: number } | null = null;
      
      for (const reserve of userReserves) {
        if (reserve.totalDebt > 0n && (!largestDebt || reserve.debtValueUsd > largestDebt.valueUsd)) {
          largestDebt = {
            asset: reserve.asset,
            amount: reserve.totalDebt,
            valueUsd: reserve.debtValueUsd
          };
        }
        
        if (reserve.aTokenBalance > 0n && (!largestCollateral || reserve.collateralValueUsd > largestCollateral.valueUsd)) {
          largestCollateral = {
            asset: reserve.asset,
            amount: reserve.aTokenBalance,
            valueUsd: reserve.collateralValueUsd
          };
        }
      }
      
      if (!largestDebt || !largestCollateral) {
        // eslint-disable-next-line no-console
        console.log(
          `[predictive-prestage] user=${normalized.slice(0, 10)}... scenario=${scenario} ` +
          `(skipped: no debt or collateral found)`
        );
        return;
      }

      // Get current block and prices
      const currentBlock = await this.getCurrentBlock();
      const debtPrice = await this.aaveDataService.getAssetPrice(largestDebt.asset);
      const debtPriceUsd = Number(debtPrice) / 1e8;

      // eslint-disable-next-line no-console
      console.log(
        `[predictive-prestage] user=${normalized.slice(0, 10)}... scenario=${scenario} ` +
        `projHf=${projectedHf.toFixed(4)} debtAsset=${largestDebt.asset.slice(0, 10)}... ` +
        `collateralAsset=${largestCollateral.asset.slice(0, 10)}... ` +
        `debtUsd=${largestDebt.valueUsd.toFixed(2)} collateralUsd=${largestCollateral.valueUsd.toFixed(2)} ` +
        `block=${currentBlock}`
      );
      
      // TODO: Sprinter integration pending
      // When SprinterEngine is available and wired, call:
      // await this.sprinterEngine?.prestageFromPredictive(
      //   normalized,
      //   largestDebt.asset,
      //   largestCollateral.asset,
      //   largestDebt.amount,
      //   largestCollateral.amount,
      //   projectedHf,
      //   currentBlock,
      //   debtPriceUsd
      // );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[predictive-prestage] Error fetching user data for ${normalized}:`, err);
    }
  }

  /**
   * Prestage a predictive candidate using SprinterEngine
   * Called from PredictiveOrchestrator listener when shouldPrestage is true
   * 
   * @deprecated Use prestageFromPredictiveCandidateWithRealData instead.
   * This method delegates to the new implementation with real data.
   */
  async prestageFromPredictiveCandidate(
    userAddress: string,
    projectedHf: number,
    totalDebtUsd: number,
    scenario: string
  ): Promise<void> {
    // Delegate to the new implementation with real data
    return this.prestageFromPredictiveCandidateWithRealData(
      userAddress,
      projectedHf,
      totalDebtUsd,
      scenario
    );
  }
}
