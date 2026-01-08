import dotenv from 'dotenv';

import { env } from './envSchema.js';

dotenv.config();

export const config = {
  get port() { return env.port; },
  get nodeEnv() { return env.nodeEnv; },

  get useMockSubgraph() { return env.useMockSubgraph; },
  get graphApiKey() { return env.graphApiKey; },
  get subgraphDeploymentId() { return env.subgraphDeploymentId; },
  get subgraphPollIntervalMs() { return env.subgraphPollIntervalMs; },
  get subgraphDebugErrors() { return env.subgraphDebugErrors; },
  get liquidationPollLimit() { return env.liquidationPollLimit; },
  get liquidationTrackMax() { return env.liquidationTrackMax; },

  // Optional raw override (header mode or custom proxy)
  get rawSubgraphUrl() { return process.env.SUBGRAPH_URL; },

  /**
   * Determine effective endpoint + auth needs.
   */
  resolveSubgraphEndpoint() {
    if (this.useMockSubgraph) {
      return { endpoint: 'mock://subgraph', mode: 'mock' as const, needsHeader: false };
    }

    const key = this.graphApiKey;
    const dep = this.subgraphDeploymentId;

    let endpoint = this.rawSubgraphUrl;
    let mode: 'path' | 'header' | 'raw' = 'raw';
    let needsHeader = false;

    if (!endpoint) {
      // Default path-embedded mode
      endpoint = `https://gateway.thegraph.com/api/${key}/subgraphs/id/${dep}`;
      mode = 'path';
      needsHeader = false;
    } else {
      const hasEmbedded = key && endpoint.includes(`/${key}/subgraphs/`);
      const matchesHeaderPattern = /https:\/\/gateway\.thegraph\.com\/api\/subgraphs\/id\//.test(endpoint);

      if (hasEmbedded) {
        mode = 'path';
        needsHeader = false;
      } else if (matchesHeaderPattern) {
        mode = 'header';
        needsHeader = true;
      } else {
        mode = 'raw';
        needsHeader = !!key; // opportunistic header if key present
      }
    }

    return { endpoint: endpoint!, mode, needsHeader };
  },

  get subgraphUrl() {
    return this.resolveSubgraphEndpoint().endpoint;
  },

  get aavePoolAddress() { return env.aavePoolAddress; },
  
  // Aave V3 Base Data Provider addresses
  get aaveAddressesProvider() { return env.aaveAddressesProvider; },
  get aaveProtocolDataProvider() { return env.aaveProtocolDataProvider; },
  get aaveOracle() { return env.aaveOracle; },
  get aavePoolConfigurator() { return env.aavePoolConfigurator; },
  get aaveUiPoolDataProvider() { return env.aaveUiPoolDataProvider; },
  get aaveWrappedTokenGateway() { return env.aaveWrappedTokenGateway; },

  // Limits / retries
  get subgraphFailureThreshold() { return env.subgraphFailureThreshold; },
  get subgraphRetryAttempts() { return env.subgraphRetryAttempts; },
  get subgraphRetryBaseMs() { return env.subgraphRetryBaseMs; },
  get subgraphRateLimitCapacity() { return env.subgraphRateLimitCapacity; },
  get subgraphRateLimitIntervalMs() { return env.subgraphRateLimitIntervalMs; },

  // Auth
  get apiKey() { return env.apiKey; },
  get jwtSecret() { return env.jwtSecret; },

  // Database
  get databaseUrl() { return env.databaseUrl; },

  // Redis
  get redisUrl() { return env.redisUrl; },
  get redisHost() { return env.redisHost; },
  get redisPort() { return env.redisPort; },

  // Fees
  get refinancingFeeBps() { return env.refinancingFeeBps; },
  get emergencyFeeBps() { return env.emergencyFeeBps; },

  // Telegram
  get telegramBotToken() { return env.telegramBotToken; },
  get telegramChatId() { return env.telegramChatId; },

  // Health monitoring
  get healthAlertThreshold() { return env.healthAlertThreshold; },
  get healthEmergencyThreshold() { return env.healthEmergencyThreshold; },

  // Profit estimation
  get profitFeeBps() { return env.profitFeeBps; },
  get profitMinUsd() { return env.profitMinUsd; },

  // Price oracle
  get priceOracleMode() { return env.priceOracleMode; },

  // Health factor resolver
  get healthUserCacheTtlMs() { return env.healthUserCacheTtlMs; },
  get healthMaxBatch() { return env.healthMaxBatch; },
  get healthQueryMode() { return env.healthQueryMode; },

  // Poll configuration
  get pollLimit() { return env.pollLimit; },
  get ignoreBootstrapBatch() { return env.ignoreBootstrapBatch; },

  // Gas cost estimation
  get gasCostUsd() { return env.gasCostUsd; },

  // Chainlink price feeds
  get chainlinkRpcUrl() { return env.chainlinkRpcUrl; },
  get chainlinkFeeds() { return env.chainlinkFeeds; },
  get priceStalenessSeconds() { return env.priceStalenessSeconds; },
  get ratioPriceEnabled() { return env.ratioPriceEnabled; },
  
  // Price feed aliases and derived assets
  get priceFeedAliases() { return env.priceFeedAliases; },
  get derivedRatioFeeds() { return env.derivedRatioFeeds; },
  get pricePollDisableAfterErrors() { return env.pricePollDisableAfterErrors; },
  
  // Price readiness and deferred valuation
  get priceDeferUntilReady() { return env.priceDeferUntilReady; },
  get priceSymbolAliases() { return env.priceSymbolAliases; },

  // Price-triggered emergency scans
  get priceTriggerEnabled() { return env.priceTriggerEnabled; },
  get priceTriggerDropBps() { return env.priceTriggerDropBps; },
  get priceTriggerMaxScan() { return env.priceTriggerMaxScan; },
  get priceTriggerAssets() { return env.priceTriggerAssets; },
  get priceTriggerDebounceSec() { return env.priceTriggerDebounceSec; },
  get priceTriggerCumulative() { return env.priceTriggerCumulative; },
  get priceTriggerPollSec() { return env.priceTriggerPollSec; },
  
  // Per-asset price trigger configuration
  get priceTriggerBpsByAsset() { return env.priceTriggerBpsByAsset; },
  get priceTriggerDebounceByAsset() { return env.priceTriggerDebounceByAsset; },
  
  // Price trigger stablecoin filtering
  get priceTriggerSkipStables() { return env.priceTriggerSkipStables; },
  get priceTriggerStablecoinList() { return env.priceTriggerStablecoinList; },
  
  // Price trigger near-band gating
  get priceTriggerNearBandOnly() { return env.priceTriggerNearBandOnly; },
  get priceTriggerNearBandBps() { return env.priceTriggerNearBandBps; },
  get priceTriggerReserveTopN() { return env.priceTriggerReserveTopN; },
  get priceTriggerJitterMinMs() { return env.priceTriggerJitterMinMs; },
  get priceTriggerJitterMaxMs() { return env.priceTriggerJitterMaxMs; },
  get priceTriggerNearBandLowerBound() { return env.priceTriggerNearBandLowerBound; },
  get priceTriggerMinIntervalSec() { return env.priceTriggerMinIntervalSec; },
  get priceTriggerGlobalRateLimit() { return env.priceTriggerGlobalRateLimit; },
  
  // Auto-discovery of Chainlink feeds and debt tokens
  get autoDiscoverFeeds() { return env.autoDiscoverFeeds; },
  
  // Reserve-targeted recheck configuration
  get reserveRecheckTopN() { return env.reserveRecheckTopN; },
  get reserveRecheckMaxBatch() { return env.reserveRecheckMaxBatch; },
  get reserveRecheckNearBandOnly() { return env.reserveRecheckNearBandOnly; },
  get reserveMinIndexDeltaBps() { return env.reserveMinIndexDeltaBps; },
  
  // Global RPC rate limiting
  get globalRpcRateLimit() { return env.globalRpcRateLimit; },
  get globalRpcBurstCapacity() { return env.globalRpcBurstCapacity; },
  get ethCallTransport() { return env.ethCallTransport; },
  get ethCallMaxInFlight() { return env.ethCallMaxInFlight; },
  
  // Pending-state verification
  get pendingVerifyEnabled() { return env.pendingVerifyEnabled; },
  
  // BorrowersIndex configuration
  get borrowersIndexEnabled() { return env.borrowersIndexEnabled; },
  get borrowersIndexMode() { return env.borrowersIndexMode; },
  get borrowersIndexRedisUrl() { return env.borrowersIndexRedisUrl; },
  get borrowersIndexMaxUsersPerReserve() { return env.borrowersIndexMaxUsersPerReserve; },
  get borrowersIndexBackfillBlocks() { return env.borrowersIndexBackfillBlocks; },
  get borrowersIndexChunkBlocks() { return env.borrowersIndexChunkBlocks; },
  
  // Startup diagnostics
  get startupDiagnostics() { return env.startupDiagnostics; },
  get startupDiagTimeoutMs() { return env.startupDiagTimeoutMs; },
  
  // Mempool transmit monitoring
  get transmitMempoolEnabled() { return env.transmitMempoolEnabled; },
  get mempoolSubscriptionMode() { return env.mempoolSubscriptionMode; },
  
  // Latency metrics
  get latencyMetricsEnabled() { return env.latencyMetricsEnabled; },
  get metricsEmitIntervalBlocks() { return env.metricsEmitIntervalBlocks; },

  // At-risk user scanning
  get atRiskScanLimit() { return env.atRiskScanLimit; },
  get atRiskWarnThreshold() { return env.atRiskWarnThreshold; },
  get atRiskLiqThreshold() { return env.atRiskLiqThreshold; },
  get atRiskDustEpsilon() { return env.atRiskDustEpsilon; },
  get atRiskNotifyWarn() { return env.atRiskNotifyWarn; },
  get atRiskNotifyCritical() { return env.atRiskNotifyCritical; },

  // Real-time HF detection
  get useRealtimeHF() { return env.useRealtimeHF; },
  get wsRpcUrl() { return env.wsRpcUrl; },
  get useFlashblocks() { return env.useFlashblocks; },
  get flashblocksWsUrl() { return env.flashblocksWsUrl; },
  get flashblocksTickMs() { return env.flashblocksTickMs; },
  get multicall3Address() { return env.multicall3Address; },
  get aavePool() { return env.aavePool; },
  get executionHfThresholdBps() { return env.executionHfThresholdBps; },
  get realtimeSeedIntervalSec() { return env.realtimeSeedIntervalSec; },
  get candidateMax() { return env.candidateMax; },
  get hysteresisBps() { return env.hysteresisBps; },
  get notifyOnlyWhenActionable() { return env.notifyOnlyWhenActionable; },
  get executionInflightLock() { return env.executionInflightLock; },

  // Subgraph usage gating
  get useSubgraph() { return env.useSubgraph; },
  get subgraphRefreshMinutes() { return env.subgraphRefreshMinutes; },

  // On-chain backfill for candidate discovery
  get realtimeInitialBackfillEnabled() { return env.realtimeInitialBackfillEnabled; },
  get realtimeInitialBackfillBlocks() { return env.realtimeInitialBackfillBlocks; },
  get realtimeInitialBackfillChunkBlocks() { return env.realtimeInitialBackfillChunkBlocks; },
  get realtimeInitialBackfillMaxLogs() { return env.realtimeInitialBackfillMaxLogs; },
  get backfillRpcUrl() { return env.backfillRpcUrl; },

  // Subgraph paging (when USE_SUBGRAPH=true)
  get subgraphPageSize() { return env.subgraphPageSize; },

  // Head-check paging/rotation
  get headCheckPageStrategy() { return env.headCheckPageStrategy; },
  get headCheckPageSize() { return env.headCheckPageSize; },
  get alwaysIncludeHfBelow() { return env.alwaysIncludeHfBelow; },

  // Optional secondary RPC for head-check fallback
  get secondaryHeadRpcUrl() { return env.secondaryHeadRpcUrl; },
  get headCheckHedgeMs() { return env.headCheckHedgeMs; },

  // Timeout and retry configuration
  get chunkTimeoutMs() { return env.chunkTimeoutMs; },
  get chunkRetryAttempts() { return env.chunkRetryAttempts; },
  get runStallAbortMs() { return env.runStallAbortMs; },
  get wsHeartbeatMs() { return env.wsHeartbeatMs; },

  // RPC-only tuning and stability configuration
  get multicallBatchSize() { return env.multicallBatchSize; },
  get headPageAdaptive() { return env.headPageAdaptive; },
  get headPageTargetMs() { return env.headPageTargetMs; },
  get headPageMin() { return env.headPageMin; },
  get headPageMax() { return env.headPageMax; },
  get eventBatchCoalesceMs() { return env.eventBatchCoalesceMs; },
  get eventBatchMaxPerBlock() { return env.eventBatchMaxPerBlock; },
  get maxParallelEventBatches() { return env.maxParallelEventBatches; },
  get adaptiveEventConcurrency() { return env.adaptiveEventConcurrency; },
  get maxParallelEventBatchesHigh() { return env.maxParallelEventBatchesHigh; },
  get eventBacklogThreshold() { return env.eventBacklogThreshold; },
  get dustMinUsd() { return env.dustMinUsd; },
  get minDebtUsd() { return env.minDebtUsd; },
  
  // Phase 1 Performance Enhancements
  get mempoolMonitorEnabled() { return env.mempoolMonitorEnabled; },
  get hfProjectionEnabled() { return env.hfProjectionEnabled; },
  get hfProjectionCriticalMin() { return env.hfProjectionCriticalMin; },
  get hfProjectionCriticalMax() { return env.hfProjectionCriticalMax; },
  get hfProjectionBlocks() { return env.hfProjectionBlocks; },
  get reserveCoalesceEnabled() { return env.reserveCoalesceEnabled; },
  get reserveCoalesceWindowMs() { return env.reserveCoalesceWindowMs; },
  get reserveCoalesceMaxBatch() { return env.reserveCoalesceMaxBatch; },
  get reserveCoalescePerReserve() { return env.reserveCoalescePerReserve; },
  get perfMetricsEnabled() { return env.perfMetricsEnabled; },
  get perfMetricsLogIntervalMs() { return env.perfMetricsLogIntervalMs; },
  get perfMetricsWindowMs() { return env.perfMetricsWindowMs; },
  get vectorizedHfEnabled() { return env.vectorizedHfEnabled; },
  get vectorizedHfCacheTtlMs() { return env.vectorizedHfCacheTtlMs; },
  get vectorizedHfMaxTtlMs() { return env.vectorizedHfMaxTtlMs; },
  get vectorizedHfMinTtlMs() { return env.vectorizedHfMinTtlMs; },
  
  // Execution configuration
  get executionEnabled() { return env.executionEnabled; },
  get dryRunExecution() { return env.dryRunExecution; },
  get closeFactorExecutionMode() { return env.closeFactorExecutionMode; },
  get liquidationDebtAssets() { return env.liquidationDebtAssets; },
  get minRepayUsd() { return env.minRepayUsd; },
  get maxTargetUsersPerTick() { return env.maxTargetUsersPerTick; },
  
  // On-chain executor
  get rpcUrl() { return process.env.RPC_URL; },
  get chainId() { return env.chainId; },

  // Rate limiting
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxRequests: 120,

  // Health factor thresholds (legacy, use healthAlertThreshold and healthEmergencyThreshold instead)
  alertThreshold: 1.1,
  emergencyThreshold: 1.05,

  // Low HF Tracker for observability
  get lowHfTrackerEnabled() { return env.lowHfTrackerEnabled; },
  get lowHfTrackerMax() { return env.lowHfTrackerMax; },
  get lowHfRecordMode() { return env.lowHfRecordMode; },
  get lowHfDumpOnShutdown() { return env.lowHfDumpOnShutdown; },
  get lowHfSummaryIntervalSec() { return env.lowHfSummaryIntervalSec; },
  get lowHfExtendedEnabled() { return env.lowHfExtendedEnabled; },

  // Liquidation configuration
  get liquidationCloseFactor() { return env.liquidationCloseFactor; },

  // Liquidation audit configuration
  get liquidationAuditEnabled() { return env.liquidationAuditEnabled; },
  get liquidationAuditNotify() { return env.liquidationAuditNotify; },
  get liquidationAuditPriceMode() { return env.liquidationAuditPriceMode; },
  get liquidationAuditSampleLimit() { return env.liquidationAuditSampleLimit; },
  
  // Decision trace and classifier
  get decisionTraceEnabled() { return env.decisionTraceEnabled; },
  get auditClassifierEnabled() { return env.auditClassifierEnabled; },
  
  // Liquidation Miss Classifier
  get missClassifierEnabled() { return env.missClassifierEnabled; },
  get missTransientBlocks() { return env.missTransientBlocks; },
  get missMinProfitUsd() { return env.missMinProfitUsd; },
  get missGasThresholdGwei() { return env.missGasThresholdGwei; },
  get missEnableProfitCheck() { return env.missEnableProfitCheck; },
  
  // Prices via Aave Oracle
  get pricesUseAaveOracle() { return env.pricesUseAaveOracle; },

  // Priority Sweep configuration
  get prioritySweepEnabled() { return env.prioritySweepEnabled; },
  get prioritySweepIntervalMin() { return env.prioritySweepIntervalMin; },
  get priorityMinDebtUsd() { return env.priorityMinDebtUsd; },
  get priorityMinCollateralUsd() { return env.priorityMinCollateralUsd; },
  get priorityTargetSize() { return env.priorityTargetSize; },
  get priorityMaxScanUsers() { return env.priorityMaxScanUsers; },
  get priorityScoreDebtWeight() { return env.priorityScoreDebtWeight; },
  get priorityScoreCollateralWeight() { return env.priorityScoreCollateralWeight; },
  get priorityScoreHfPenalty() { return env.priorityScoreHfPenalty; },
  get priorityScoreHfCeiling() { return env.priorityScoreHfCeiling; },
  get priorityScoreLowHfBoost() { return env.priorityScoreLowHfBoost; },
  get prioritySweepLogSummary() { return env.prioritySweepLogSummary; },
  get prioritySweepMetricsEnabled() { return env.prioritySweepMetricsEnabled; },
  get prioritySweepTimeoutMs() { return env.prioritySweepTimeoutMs; },
  get prioritySweepPageSize() { return env.prioritySweepPageSize; },
  get prioritySweepInterRequestMs() { return env.prioritySweepInterRequestMs; },
  get hotlistMaxHf() { return env.hotlistMaxHf; },
  
  // Hotlist configuration
  get hotlistEnabled() { return env.hotSetEnabled; },
  get hotlistMinHf() { return env.hotlistMinHf; },
  get hotlistMax() { return env.hotlistMax; },
  get hotlistMinDebtUsd() { return env.hotlistMinDebtUsd; },
  get hotlistRevisitSec() { return env.hotlistRevisitSec; },
  
  // Hot/Warm set tracking (legacy names)
  get hotSetEnabled() { return env.hotSetEnabled; },
  get hotSetHfMax() { return env.hotSetHfMax; },
  get warmSetHfMax() { return env.warmSetHfMax; },
  get maxHotSize() { return env.maxHotSize; },
  get maxWarmSize() { return env.maxWarmSize; },
  
  // Precompute configuration
  get precomputeEnabled() { return env.precomputeEnabled; },
  get precomputeTopK() { return env.precomputeTopK; },
  get precomputeCloseFactorPct() { return env.precomputeCloseFactorPct; },
  get precomputeReceiveAToken() { return env.precomputeReceiveAToken; },
  
  // Fast-lane execution enhancements
  get txSubmitMode() { 
    return (process.env.TX_SUBMIT_MODE as 'public' | 'private') || 'public'; 
  },
  get privateTxRpcUrl() { 
    return process.env.PRIVATE_TX_RPC_URL; 
  },
  get gasTipGweiFast() { 
    return parseFloat(process.env.GAS_TIP_GWEI_FAST || '3'); 
  },
  get gasBumpFactor() { 
    return parseFloat(process.env.GAS_BUMP_FACTOR || '1.25'); 
  },
  get gasBumpIntervalMs() { 
    return parseInt(process.env.GAS_BUMP_INTERVAL_MS || '500', 10); 
  },
  get gasBumpMax() { 
    return parseInt(process.env.GAS_BUMP_MAX || '3', 10); 
  },
  get gasMaxFeeGwei() { 
    const val = process.env.GAS_MAX_FEE_GWEI;
    return val ? parseFloat(val) : undefined;
  },
  get fastLaneHfBufferBps() { 
    return parseInt(process.env.FAST_LANE_HF_BUFFER_BPS || '2', 10); 
  },
  get quoteRefreshMs() { 
    return parseInt(process.env.QUOTE_REFRESH_MS || '750', 10); 
  },
  get fastLaneEnabled() {
    return process.env.FAST_LANE_ENABLED === 'true' || process.env.FAST_LANE_ENABLED === undefined;
  },
  
  // Shadow execution configuration
  get shadowExecuteEnabled() {
    return process.env.SHADOW_EXECUTE_ENABLED === 'true';
  },
  get shadowExecuteThreshold() {
    return parseFloat(process.env.SHADOW_EXECUTE_THRESHOLD || '1.005');
  },
  
  // Execution Path Acceleration Configuration
  get preSimEnabled() { return env.preSimEnabled; },
  get preSimHfWindow() { return env.preSimHfWindow; },
  get preSimMinDebtUsd() { return env.preSimMinDebtUsd; },
  get preSimCacheTtlBlocks() { return env.preSimCacheTtlBlocks; },
  get gasLadderEnabled() { return env.gasLadderEnabled; },
  get gasLadderFastTipGwei() { return env.gasLadderFastTipGwei; },
  get gasLadderMidTipGwei() { return env.gasLadderMidTipGwei; },
  get gasLadderSafeTipGwei() { return env.gasLadderSafeTipGwei; },
  get approvalsAutoSend() { return env.approvalsAutoSend; },
  
  // Sprinter high-priority execution path
  get sprinterEnabled() { return env.sprinterEnabled; },
  get prestageHfBps() { return env.prestageHfBps; },
  get sprinterMaxPrestaged() { return env.sprinterMaxPrestaged; },
  get sprinterStaleBlocks() { return env.sprinterStaleBlocks; },
  get sprinterVerifyBatch() { return env.sprinterVerifyBatch; },
  get writeRpcs() { return env.writeRpcs; },
  get writeRaceTimeoutMs() { return env.writeRaceTimeoutMs; },
  get optimisticEnabled() { return env.optimisticEnabled; },
  get optimisticEpsilonBps() { return env.optimisticEpsilonBps; },
  get executionPrivateKeys() { return env.executionPrivateKeys; },
  get templateRefreshIndexBps() { return env.templateRefreshIndexBps; },
  
  // Redis L2 Cache & Coordination
  get redisEnablePipelining() { return env.redisEnablePipelining; },
  get redisMaxPipeline() { return env.redisMaxPipeline; },
  get riskCacheCompress() { return env.riskCacheCompress; },
  
  // Predictive Health Factor Engine
  get predictiveEnabled() { return env.predictiveEnabled; },
  get predictiveHfBufferBps() { return env.predictiveHfBufferBps; },
  get predictiveMaxUsersPerTick() { return env.predictiveMaxUsersPerTick; },
  get predictiveHorizonSec() { return env.predictiveHorizonSec; },
  get predictiveScenarios() { return env.predictiveScenarios; },
  get predictiveQueueEnabled() { return env.predictiveQueueEnabled; },
  get predictiveMicroVerifyEnabled() { return env.predictiveMicroVerifyEnabled; },
  get predictiveFastpathEnabled() { return env.predictiveFastpathEnabled; },
  get predictiveNearOnly() { return env.predictiveNearOnly; },
  get predictiveNearBandBps() { return env.predictiveNearBandBps; },
  get predictiveDynamicBufferEnabled() { return env.predictiveDynamicBufferEnabled; },
  get predictiveVolatilityBpsScaleMin() { return env.predictiveVolatilityBpsScaleMin; },
  get predictiveVolatilityBpsScaleMax() { return env.predictiveVolatilityBpsScaleMax; },
  get predictiveFallbackIntervalBlocks() { return env.predictiveFallbackIntervalBlocks; },
  get predictiveFallbackIntervalMs() { return env.predictiveFallbackIntervalMs; },
  get predictiveFallbackEnabled() { return env.predictiveFallbackEnabled; },
  get predictiveFallbackNearOnly() { return env.predictiveFallbackNearOnly; },
  get fastpathPredictiveEtaCapSec() { return env.fastpathPredictiveEtaCapSec; },
  get predictivePriorityHfWeight() { return env.predictivePriorityHfWeight; },
  get predictivePriorityEtaWeight() { return env.predictivePriorityEtaWeight; },
  get predictivePriorityDebtWeight() { return env.predictivePriorityDebtWeight; },
  get predictivePriorityScenarioWeightBaseline() { return env.predictivePriorityScenarioWeightBaseline; },
  get predictivePriorityScenarioWeightAdverse() { return env.predictivePriorityScenarioWeightAdverse; },
  get predictivePriorityScenarioWeightExtreme() { return env.predictivePriorityScenarioWeightExtreme; },
  // Predictive RPC Optimization
  get predictiveSignalGateEnabled() { return env.predictiveSignalGateEnabled; },
  get predictivePythDeltaPct() { return env.predictivePythDeltaPct; },
  get predictiveMaxTicksPerMin() { return env.predictiveMaxTicksPerMin; },
  get predictiveRpcBudgetUsdPerHour() { return env.predictiveRpcBudgetUsdPerHour; },
  get predictiveMaxUsersPerSignalPerAsset() { return env.predictiveMaxUsersPerSignalPerAsset; },
  get predictiveDedupCacheTtlSec() { return env.predictiveDedupCacheTtlSec; },
  get predictiveDedupCacheMaxSize() { return env.predictiveDedupCacheMaxSize; },
  get perUserBlockDebounce() { return env.perUserBlockDebounce; },
  get indexJumpPredictionEnabled() { return env.indexJumpPredictionEnabled; },
  get indexJumpMinBps() { return env.indexJumpMinBps; },
  
  // Micro-Verification Fast Path
  get microVerifyEnabled() { return env.microVerifyEnabled; },
  get microVerifyMaxPerBlock() { return env.microVerifyMaxPerBlock; },
  get microVerifyIntervalMs() { return env.microVerifyIntervalMs; },
  get microVerifyCacheTtlMs() { return env.microVerifyCacheTtlMs; },
  get nearThresholdBandBps() { return env.nearThresholdBandBps; },
  get nearBandBps() { return env.nearBandBps; },
  get reserveFastSubsetMax() { return env.reserveFastSubsetMax; },
  get headCriticalBatchSize() { return env.headCriticalBatchSize; },
  
  // Tier 0 + Tier 1 Performance Upgrades
  get reserveFastSubsetSweepDelayMs() { return env.reserveFastSubsetSweepDelayMs; },
  get microVerifyHedgeForSingle() { return env.microVerifyHedgeForSingle; },
  get microVerifyDedicatedRpc() { return env.microVerifyDedicatedRpc; },
  get postLiquidationRefresh() { return env.postLiquidationRefresh; },
  get addressNormalizeLowercase() { return env.addressNormalizeLowercase; },
  get indexJumpBpsTrigger() { return env.indexJumpBpsTrigger; },
  get hfPredCritical() { return env.hfPredCritical; },
  get riskOrderingSimple() { return env.riskOrderingSimple; },
  
  // Critical Lane for Sub-1.0 HF Liquidations
  get criticalLaneEnabled() { return env.criticalLaneEnabled; },
  get criticalLaneProfitMinUsd() { return env.criticalLaneProfitMinUsd; },
  get criticalLaneAllowUnprofitableInitial() { return env.criticalLaneAllowUnprofitableInitial; },
  get criticalLaneLatencyWarnMs() { return env.criticalLaneLatencyWarnMs; },
  get criticalLaneLoadShed() { return env.criticalLaneLoadShed; },
  get criticalLaneReverifyMode() { return env.criticalLaneReverifyMode; },
  get criticalLaneMaxReverifyReserves() { return env.criticalLaneMaxReverifyReserves; },
  get criticalLaneLatencyAbortMs() { return env.criticalLaneLatencyAbortMs; },
  get criticalLaneMinDebtUsd() { return env.criticalLaneMinDebtUsd; },
  get criticalLaneMinProfitUsd() { return env.criticalLaneMinProfitUsd; },
  get priceFastTtlMs() { return env.priceFastTtlMs; },
  get userSnapshotTtlMs() { return env.userSnapshotTtlMs; },
  get templateRefreshIntervalMs() { return env.templateRefreshIntervalMs; },
  get fastGasMode() { return env.fastGasMode; },
  get privateTxRpc() { return env.privateTxRpc; },
  get privateTxMode() { return env.privateTxMode; },
  get redisPipelineEnabled() { return env.redisPipelineEnabled; },
  
  // Fast-path Latency & Instrumentation
  get fastpathLatencyEnabled() { return env.fastpathLatencyEnabled; },
  get fastpathHedgeSmallDisable() { return env.fastpathHedgeSmallDisable; },
  get fastpathPriceCacheTtlMs() { return env.fastpathPriceCacheTtlMs; },
  get fastpathGasCacheTtlMs() { return env.fastpathGasCacheTtlMs; },
  get fastpathEventPublish() { return env.fastpathEventPublish; },
  get criticalLanePublishMinHf() { return env.criticalLanePublishMinHf; },
  get criticalLaneMinExecuteHf() { return env.criticalLaneMinExecuteHf; },
  get fastpathLogDetail() { return env.fastpathLogDetail; },
  get fastpathLatencyMetrics() { return env.fastpathLatencyMetrics; },
  
  // File logging configuration
  get logFileEnabled() { return env.logFileEnabled; },
  get logFileRetentionHours() { return env.logFileRetentionHours; },
  
  // Pyth Network Integration
  get pythEnabled() { return env.pythEnabled; },
  get pythWsUrl() { return env.pythWsUrl; },
  get pythHttpUrl() { return env.pythHttpUrl; },
  get pythAssets() { return env.pythAssets; },
  get pythStaleSecs() { return env.pythStaleSecs; },
  get pythFeedMapPath() { return env.pythFeedMapPath; },
  
  // TWAP Sanity Check Configuration
  get twapEnabled() { return env.twapEnabled; },
  get twapWindowSec() { return env.twapWindowSec; },
  get twapDeltaPct() { return env.twapDeltaPct; },
  get twapPools() { return env.twapPools; },
  
  // Pre-Submit Liquidation Pipeline
  get preSubmitEnabled() { return env.preSubmitEnabled; },
  get preSubmitEtaMax() { return env.preSubmitEtaMax; },
  get hfTriggerBuffer() { return env.hfTriggerBuffer; },
  get gasPriceMargin() { return env.gasPriceMargin; },
  get ttlBlocks() { return env.ttlBlocks; },
  get preSubmitMinPositionUsd() { return env.preSubmitMinPositionUsd; },
  get telemetryPreSubmitEnabled() { return env.telemetryPreSubmitEnabled; }
};
