#!/usr/bin/env node
/**
 * test-twap-sanity.mjs
 *
 * Validates TWAP oracle sanity by comparing against Chainlink prices.
 *
 * Purpose:
 * - Compute TWAP over configured window for each asset
 * - Compare TWAP against Chainlink oracle prices
 * - Report delta vs threshold and overall pass/fail
 *
 * Usage:
 *   # Via environment variable
 *   TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]' node scripts/test-twap-sanity.mjs
 *
 *   # Via CLI argument (recommended for Windows)
 *   node scripts/test-twap-sanity.mjs --twap-pools '[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]'
 *
 *   # Via JSON file (easiest for multiple pools)
 *   node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json
 *
 *   # Additional options
 *   node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json --window 600 --delta 0.02
 *
 * CLI Arguments:
 *   --twap-pools <json>        JSON array of pool configurations
 *   --twap-pools-file <path>   Path to JSON file with pool configurations
 *   --window <seconds>         TWAP observation window in seconds (default: 300)
 *   --delta <percentage>       Max allowed delta as decimal (default: 0.012 = 1.2%)
 *   --help                     Show this help message
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required)
 *   - TWAP_POOLS: JSON array of pool configs (fallback if no CLI args)
 *   - TWAP_WINDOW_SEC: TWAP observation window in seconds (default: 300)
 *   - TWAP_DELTA_PCT: Max allowed delta percentage (default: 0.012 = 1.2%)
 *   - CHAINLINK_FEEDS: Comma-separated "SYMBOL:ADDRESS" pairs
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Uniswap V3 Pool ABI (minimal for TWAP)
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function observe(uint32[] calldata secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

// Chainlink Aggregator ABI
const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

/**
 * Show help message
 */
function showHelp() {
  console.log(`
TWAP Sanity Check - Oracle Validation Tool

USAGE:
  # Via environment variable
  TWAP_POOLS='[...]' node scripts/test-twap-sanity.mjs

  # Via CLI argument (recommended for Windows)
  node scripts/test-twap-sanity.mjs --twap-pools '[...]'

  # Via JSON file (easiest for multiple pools)
  node scripts/test-twap-sanity.mjs --twap-pools-file ./config/twap-pools.json

OPTIONS:
  --twap-pools <json>        JSON array of pool configurations
  --twap-pools-file <path>   Path to JSON file with pool configurations
  --window <seconds>         TWAP observation window in seconds (default: 300)
  --delta <percentage>       Max allowed delta as decimal (default: 0.012)
  --help                     Show this help message

ENVIRONMENT VARIABLES:
  RPC_URL                    Base RPC endpoint (required)
  TWAP_POOLS                 JSON array of pool configs (fallback if no CLI args)
  TWAP_WINDOW_SEC            TWAP observation window in seconds
  TWAP_DELTA_PCT             Max allowed delta percentage
  CHAINLINK_FEEDS            Comma-separated "SYMBOL:ADDRESS" pairs

EXAMPLES:
  # Single pool via CLI
  node scripts/test-twap-sanity.mjs --twap-pools '[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]'

  # Multiple pools via file
  node scripts/test-twap-sanity.mjs --twap-pools-file ./my-pools.json

  # Custom window and delta
  node scripts/test-twap-sanity.mjs --twap-pools-file ./pools.json --window 600 --delta 0.02

POOL CONFIG FORMAT:
  [
    {
      "symbol": "WETH",
      "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
      "dex": "uniswap_v3"
    }
  ]
`);
  process.exit(0);
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    twapPools: null,
    twapPoolsFile: null,
    window: null,
    delta: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
    } else if (arg === '--twap-pools') {
      if (i + 1 >= args.length) {
        console.error('Error: --twap-pools requires a JSON argument');
        process.exit(1);
      }
      parsed.twapPools = args[++i];
    } else if (arg === '--twap-pools-file') {
      if (i + 1 >= args.length) {
        console.error('Error: --twap-pools-file requires a file path argument');
        process.exit(1);
      }
      parsed.twapPoolsFile = args[++i];
    } else if (arg === '--window') {
      if (i + 1 >= args.length) {
        console.error('Error: --window requires a numeric argument (seconds)');
        process.exit(1);
      }
      const windowArg = args[++i];
      const windowValue = parseInt(windowArg, 10);
      if (isNaN(windowValue) || windowValue <= 0) {
        console.error(`Error: --window must be a positive number, got: ${windowArg}`);
        process.exit(1);
      }
      parsed.window = windowValue;
    } else if (arg === '--delta') {
      if (i + 1 >= args.length) {
        console.error('Error: --delta requires a numeric argument (decimal percentage)');
        process.exit(1);
      }
      const deltaArg = args[++i];
      const deltaValue = parseFloat(deltaArg);
      if (isNaN(deltaValue) || deltaValue < 0 || deltaValue > 1) {
        console.error(`Error: --delta must be a number between 0 and 1, got: ${deltaArg}`);
        process.exit(1);
      }
      parsed.delta = deltaValue;
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }
  }

  return parsed;
}

/**
 * Load TWAP pools from JSON file
 */
function loadTwapPoolsFromFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // Support both array format and object with "pools" key
    if (Array.isArray(data)) {
      return data;
    } else if (data.pools && Array.isArray(data.pools)) {
      return data.pools;
    } else {
      throw new Error('File must contain a JSON array or an object with a "pools" array');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw new Error(`Failed to load pools from ${filePath}: ${err.message}`);
  }
}

/**
 * Parse TWAP_POOLS from JSON string
 */
function parseTwapPools(poolsJson) {
  if (!poolsJson || !poolsJson.trim()) {
    return [];
  }
  try {
    const pools = JSON.parse(poolsJson);
    if (!Array.isArray(pools)) {
      throw new Error("TWAP_POOLS must be an array");
    }
    return pools;
  } catch (err) {
    throw new Error(`Failed to parse TWAP_POOLS JSON: ${err.message}`);
  }
}

/**
 * Load TWAP pools with fallback priority:
 * 1. CLI --twap-pools argument
 * 2. CLI --twap-pools-file argument
 * 3. TWAP_POOLS environment variable
 */
function loadTwapPools(cliArgs) {
  const sources = [];
  
  // Priority 1: CLI --twap-pools
  if (cliArgs.twapPools) {
    sources.push({
      name: 'CLI argument --twap-pools',
      load: () => parseTwapPools(cliArgs.twapPools),
    });
  }
  
  // Priority 2: CLI --twap-pools-file
  if (cliArgs.twapPoolsFile) {
    sources.push({
      name: `JSON file: ${cliArgs.twapPoolsFile}`,
      load: () => loadTwapPoolsFromFile(cliArgs.twapPoolsFile),
    });
  }
  
  // Priority 3: TWAP_POOLS environment variable
  if (process.env.TWAP_POOLS) {
    sources.push({
      name: 'Environment variable TWAP_POOLS',
      load: () => parseTwapPools(process.env.TWAP_POOLS),
    });
  }
  
  // Try each source in priority order
  const errors = [];
  for (const source of sources) {
    try {
      const pools = source.load();
      if (pools.length > 0) {
        console.log(`✅ Loaded ${pools.length} pool(s) from: ${source.name}\n`);
        return pools;
      } else {
        // Empty array is valid but not useful - treat as a soft failure
        errors.push({ source: source.name, error: 'Configuration contains no pools (empty array)' });
      }
    } catch (err) {
      errors.push({ source: source.name, error: err.message });
    }
  }
  
  // No valid source found
  if (errors.length > 0) {
    console.error('❌ Failed to load TWAP pool configuration:\n');
    for (const { source, error } of errors) {
      console.error(`  ${source}: ${error}`);
    }
    console.error('\nPlease provide pool configuration via one of:');
    console.error('  1. --twap-pools \'[{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3"}]\'');
    console.error('  2. --twap-pools-file ./config/twap-pools.json');
    console.error('  3. TWAP_POOLS environment variable');
    console.error('\nUse --help for more information');
    process.exit(1);
  }
  
  // No configuration provided at all
  console.error('❌ No TWAP pool configuration provided');
  console.error('\nPlease provide pool configuration via one of:');
  console.error('  1. --twap-pools \'[{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3"}]\'');
  console.error('  2. --twap-pools-file ./config/twap-pools.json');
  console.error('  3. TWAP_POOLS environment variable');
  console.error('\nExample configuration:');
  console.error('  [{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]');
  console.error('\nUse --help for more information');
  process.exit(1);
}

/**
 * Validate pool configuration
 */
function validatePoolConfig(poolConfig) {
  const { symbol, pool, dex } = poolConfig;
  
  if (!symbol || typeof symbol !== 'string') {
    throw new Error(`Invalid pool config: missing or invalid symbol`);
  }
  
  if (!pool || typeof pool !== 'string') {
    throw new Error(`Invalid pool config for ${symbol}: missing or invalid pool address`);
  }
  
  // Validate Ethereum address format (0x followed by 40 hex characters)
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool)) {
    throw new Error(`Invalid pool config for ${symbol}: pool address "${pool}" is not a valid Ethereum address`);
  }
  
  if (!dex || typeof dex !== 'string') {
    throw new Error(`Invalid pool config for ${symbol}: missing or invalid dex`);
  }
  
  return true;
}

/**
 * Parse Chainlink feeds from env
 */
function parseChainlinkFeeds(feedsEnv) {
  if (!feedsEnv || !feedsEnv.trim()) {
    return {};
  }

  const feeds = {};
  const pairs = feedsEnv.split(",");
  for (const pair of pairs) {
    const [symbol, address] = pair.split(":").map((s) => s.trim());
    if (symbol && address) {
      feeds[symbol.toUpperCase()] = address;
    }
  }
  return feeds;
}

/**
 * Compute TWAP from Uniswap V3 pool observations
 */
async function computeTwap(provider, poolAddress, windowSec) {
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

  try {
    // Fetch slot0 to check observation cardinality
    const slot0 = await pool.slot0();
    const observationCardinality = Number(slot0.observationCardinality);
    
    // Warn if cardinality is too low for the requested window
    // Each observation can be at most ~13 seconds apart (on Ethereum mainnet)
    // Base network may have different block times, but 2 is absolute minimum
    if (observationCardinality < 2) {
      return { 
        success: false, 
        error: `Observation cardinality too low: ${observationCardinality} (minimum 2 required)` 
      };
    }
    
    // Fetch token addresses for reporting
    const [token0Address, token1Address] = await Promise.all([
      pool.token0(),
      pool.token1()
    ]);
    
    // Query observations at [now, now - windowSec]
    const secondsAgos = [0, windowSec];
    const [tickCumulatives] = await pool.observe(secondsAgos);

    // BigInt-safe math: compute tick delta and average tick
    // Avoid Number() on large cumulatives to prevent precision loss
    const delta = tickCumulatives[0] - tickCumulatives[1];  // Keep as BigInt
    const time = BigInt(windowSec);
    // Split into integer and fractional parts for precision
    const avgTick = Number(delta / time) + Number(delta % time) / Number(time);

    // Convert tick to price: price = 1.0001^avgTick
    // This represents token1 per token0
    // For WETH/USDC pools where token0=WETH and token1=USDC, this gives USDC per WETH
    const price = Math.pow(1.0001, avgTick);

    return { 
      success: true, 
      price, 
      avgTick, 
      observationCardinality,
      token0: token0Address,
      token1: token1Address
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch Chainlink price
 */
async function fetchChainlinkPrice(provider, feedAddress) {
  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);

  try {
    const [decimals, latestRound] = await Promise.all([
      feed.decimals(),
      feed.latestRoundData(),
    ]);

    // Use ethers.formatUnits to avoid BigInt conversion errors (ethers v6)
    const price = parseFloat(ethers.formatUnits(latestRound.answer, decimals));
    const updatedAt = Number(latestRound.updatedAt);
    const age = Math.floor(Date.now() / 1000) - updatedAt;

    return { success: true, price, decimals, updatedAt, age };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Compare TWAP vs Chainlink price
 */
function comparePrices(twapPrice, chainlinkPrice, maxDeltaPct) {
  const delta = Math.abs(twapPrice - chainlinkPrice);
  const deltaPct = (delta / chainlinkPrice) * 100;
  const withinThreshold = deltaPct <= maxDeltaPct * 100;

  return { delta, deltaPct, withinThreshold };
}

/**
 * Main sanity check logic
 */
async function main() {
  // Parse CLI arguments
  const cliArgs = parseArgs();
  
  // Load configuration
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("Error: RPC_URL environment variable is required");
    process.exit(1);
  }

  const pools = loadTwapPools(cliArgs);
  
  const windowSec = cliArgs.window || parseInt(process.env.TWAP_WINDOW_SEC || "300", 10);
  const maxDeltaPct = cliArgs.delta || parseFloat(process.env.TWAP_DELTA_PCT || "0.012");
  const chainlinkFeedsEnv = process.env.CHAINLINK_FEEDS || "";

  console.log("🔍 TWAP Sanity Check");
  console.log("=========================================\n");
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`TWAP Window: ${windowSec}s`);
  console.log(`Max Delta: ${(maxDeltaPct * 100).toFixed(2)}%\n`);

  const chainlinkFeeds = parseChainlinkFeeds(chainlinkFeedsEnv);

  // Validate all pool configurations
  console.log("Validating pool configurations...\n");
  for (const poolConfig of pools) {
    try {
      validatePoolConfig(poolConfig);
    } catch (err) {
      console.error(`❌ Validation failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`Testing ${pools.length} pool(s)...\n`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const results = [];

  for (const poolConfig of pools) {
    const { symbol, pool: poolAddress, dex } = poolConfig;

    console.log(`📊 ${symbol} (${dex})`);
    console.log("-".repeat(60));
    console.log(`Pool: ${poolAddress}`);

    // Compute TWAP
    const twapResult = await computeTwap(provider, poolAddress, windowSec);
    if (!twapResult.success) {
      console.log(`  ❌ TWAP computation failed: ${twapResult.error}\n`);
      results.push({ symbol, success: false, reason: "twap_failed" });
      continue;
    }

    console.log(`  TWAP Price: ${twapResult.price.toFixed(6)} (avg tick: ${twapResult.avgTick.toFixed(2)})`);
    console.log(`  Observation Cardinality: ${twapResult.observationCardinality}`);
    console.log(`  Token0: ${twapResult.token0}`);
    console.log(`  Token1: ${twapResult.token1}`);
    console.log(`  Note: Price is token1/token0 (for WETH/USDC: USDC per WETH ≈ USD price)`);

    // Fetch Chainlink price if available
    const chainlinkFeed = chainlinkFeeds[symbol];
    if (!chainlinkFeed) {
      console.log(`  ⚠️  No Chainlink feed configured for ${symbol}, skipping comparison`);
      console.log(`     Configure CHAINLINK_FEEDS to enable sanity checking\n`);
      results.push({ 
        symbol, 
        success: true, 
        twapPrice: twapResult.price, 
        chainlinkPrice: null,
        skipped: true,
        reason: 'no_chainlink_feed'
      });
      continue;
    }

    const chainlinkResult = await fetchChainlinkPrice(provider, chainlinkFeed);
    if (!chainlinkResult.success) {
      console.log(`  ❌ Chainlink fetch failed: ${chainlinkResult.error}\n`);
      results.push({ symbol, success: false, reason: "chainlink_failed" });
      continue;
    }

    console.log(`  Chainlink Price: ${chainlinkResult.price.toFixed(6)} (age: ${chainlinkResult.age}s)`);

    // Compare
    const comparison = comparePrices(
      twapResult.price,
      chainlinkResult.price,
      maxDeltaPct
    );

    console.log(`  Delta: ${comparison.delta.toFixed(6)} (${comparison.deltaPct.toFixed(2)}%)`);
    if (comparison.withinThreshold) {
      console.log(`  ✅ PASS - Delta within threshold\n`);
    } else {
      console.log(`  ❌ FAIL - Delta exceeds threshold\n`);
    }

    results.push({
      symbol,
      success: comparison.withinThreshold,
      twapPrice: twapResult.price,
      chainlinkPrice: chainlinkResult.price,
      delta: comparison.delta,
      deltaPct: comparison.deltaPct,
    });
  }

  // Summary
  console.log("\n✨ Summary");
  console.log("=========================================\n");

  const passed = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.length - passed - skipped;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  if (skipped > 0) {
    console.log(`Skipped: ${skipped} (no Chainlink feed configured)`);
  }
  console.log(`Failed: ${failed}\n`);

  for (const result of results) {
    if (result.skipped) {
      const status = "⚠️  SKIP";
      console.log(`  ${status} ${result.symbol} (no Chainlink feed)`);
    } else {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      const deltaStr = result.deltaPct
        ? ` (Δ ${result.deltaPct.toFixed(2)}%)`
        : "";
      console.log(`  ${status} ${result.symbol}${deltaStr}`);
    }
  }

  if (failed === 0 && skipped < results.length) {
    console.log("\n✅ All TWAP sanity checks passed\n");
  } else if (failed === 0 && skipped === results.length) {
    console.log("\n⚠️  All checks skipped - configure CHAINLINK_FEEDS to enable validation\n");
  } else {
    console.log("\n⚠️  Some TWAP sanity checks failed - review deltas and configuration\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
