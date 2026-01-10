#!/usr/bin/env node
/**
 * test-oracles-integration.mjs
 *
 * Integrated oracle testing script combining Pyth Hermes and TWAP validations.
 *
 * Purpose:
 * - Validate Pyth Hermes connectivity (REST endpoint)
 * - Validate TWAP oracle sanity vs Chainlink prices
 * - Cross-validate pricing sources when available
 * - Generate comprehensive oracle health report
 *
 * Usage:
 *   node scripts/test-oracles-integration.mjs
 *   RPC_URL=https://mainnet.base.org PYTH_ASSETS=WETH,cbETH node scripts/test-oracles-integration.mjs
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required for TWAP)
 *   - PYTH_HTTP_URL: Pyth Hermes REST endpoint (default: https://hermes.pyth.network)
 *   - PYTH_ASSETS: Comma-separated asset symbols for Pyth (default: WETH,WBTC,cbETH,USDC)
 *   - PYTH_FEED_MAP_PATH: Path to feed map JSON (optional)
 *   - PYTH_STALE_SECS: Staleness threshold in seconds (default: 10)
 *   - TWAP_POOLS: JSON array of pool configs (optional)
 *   - TWAP_WINDOW_SEC: TWAP observation window in seconds (default: 300)
 *   - TWAP_DELTA_PCT: Max allowed delta percentage (default: 0.012 = 1.2%)
 *   - CHAINLINK_FEEDS: Comma-separated "SYMBOL:ADDRESS" pairs (optional)
 */

import https from "https";
import http from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Pyth Hermes Integration
// ============================================================================

/**
 * Load feed map from JSON file
 */
function loadFeedMap(path) {
  if (!path) {
    return null;
  }
  try {
    const data = readFileSync(path, "utf-8");
    const parsed = JSON.parse(data);
    return parsed.feeds || {};
  } catch (err) {
    console.warn(`Warning: Failed to load feed map from ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Parse asset symbols from env
 */
function parseAssets(assetsEnv) {
  if (!assetsEnv || !assetsEnv.trim()) {
    return [];
  }
  return assetsEnv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Fetch data from Hermes REST endpoint
 */
function fetchRest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${res.statusMessage}\n${data}`
              )
            );
          } else {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Failed to parse JSON: ${err.message}`));
            }
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

/**
 * Test REST endpoint for a single Pyth feed
 */
async function testPythFeed(httpUrl, feedId, symbol, staleSecs) {
  const url = `${httpUrl}/v2/updates/price/latest?ids[]=${feedId}`;
  try {
    const data = await fetchRest(url);
    if (!data.parsed || data.parsed.length === 0) {
      return { success: false, reason: "no_data", symbol };
    }

    const priceData = data.parsed[0];
    const price = priceData.price;
    const publishTime = price?.publish_time || 0;
    const conf = price?.conf || "N/A";
    const expo = price?.expo || 0;

    const now = Math.floor(Date.now() / 1000);
    const age = now - publishTime;
    const isStale = age > staleSecs;

    return {
      success: true,
      symbol,
      price: price.price,
      publishTime,
      age,
      isStale,
      expo,
      conf,
    };
  } catch (err) {
    return { success: false, reason: err.message, symbol };
  }
}

// ============================================================================
// TWAP Integration
// ============================================================================

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
 * Parse TWAP_POOLS from JSON string
 */
function parseTwapPools(poolsEnv) {
  if (!poolsEnv || !poolsEnv.trim()) {
    return [];
  }
  try {
    const pools = JSON.parse(poolsEnv);
    if (!Array.isArray(pools)) {
      throw new Error("TWAP_POOLS must be an array");
    }
    return pools;
  } catch (err) {
    throw new Error(`Failed to parse TWAP_POOLS: ${err.message}`);
  }
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
 * Test TWAP for a single pool
 */
async function testTwapPool(provider, poolConfig, windowSec, chainlinkFeeds, maxDeltaPct) {
  const { symbol, pool: poolAddress, dex } = poolConfig;

  try {
    validatePoolConfig(poolConfig);
  } catch (err) {
    return { success: false, symbol, reason: err.message };
  }

  // Compute TWAP
  const twapResult = await computeTwap(provider, poolAddress, windowSec);
  if (!twapResult.success) {
    return { success: false, symbol, reason: "twap_failed", error: twapResult.error };
  }

  const result = {
    success: true,
    symbol,
    twapPrice: twapResult.price,
    avgTick: twapResult.avgTick,
    observationCardinality: twapResult.observationCardinality,
    token0: twapResult.token0,
    token1: twapResult.token1,
  };

  // Fetch Chainlink price if available
  const chainlinkFeed = chainlinkFeeds[symbol];
  if (chainlinkFeed) {
    const chainlinkResult = await fetchChainlinkPrice(provider, chainlinkFeed);
    if (chainlinkResult.success) {
      result.chainlinkPrice = chainlinkResult.price;
      result.chainlinkAge = chainlinkResult.age;
      
      // Compare
      const delta = Math.abs(twapResult.price - chainlinkResult.price);
      const deltaPct = (delta / chainlinkResult.price) * 100;
      result.delta = delta;
      result.deltaPct = deltaPct;
      result.withinThreshold = deltaPct <= maxDeltaPct * 100;
    }
  }

  return result;
}

// ============================================================================
// Main Integration Test
// ============================================================================

async function main() {
  console.log("🔍 Oracle Integration Test");
  console.log("=========================================\n");

  // ========== Pyth Hermes Tests ==========
  console.log("📡 PART 1: Pyth Hermes REST Tests");
  console.log("-".repeat(60));

  const pythHttpUrl = process.env.PYTH_HTTP_URL || "https://hermes.pyth.network";
  const pythAssetsEnv = process.env.PYTH_ASSETS || "WETH,WBTC,cbETH,USDC";
  // Default to config/pyth-feeds.json relative to backend directory
  const defaultFeedMapPath = join(__dirname, "..", "config", "pyth-feeds.json");
  const feedMapPath = process.env.PYTH_FEED_MAP_PATH || defaultFeedMapPath;
  const pythStaleSecs = parseInt(process.env.PYTH_STALE_SECS || "10", 10);

  console.log(`Pyth HTTP URL: ${pythHttpUrl}`);
  console.log(`Pyth Assets: ${pythAssetsEnv}`);
  console.log(`Staleness Threshold: ${pythStaleSecs}s\n`);

  const pythAssets = parseAssets(pythAssetsEnv);
  const feedMap = loadFeedMap(feedMapPath);

  // Default feed IDs for common assets
  const defaultFeeds = {
    WETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    WBTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    CBBTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    CBETH: "0x15ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce5717",
    WEETH: "0x9ee4e7c60b940440a261eb54b6d8149c23b580ed7da3139f7f08f4ea29dad395",
  };

  // Resolve feed IDs (case-insensitive lookup)
  const pythFeedsToTest = [];
  for (const symbol of pythAssets) {
    let feedId = null;
    // Try feed map first (case-insensitive)
    if (feedMap) {
      const feedMapEntry = Object.keys(feedMap).find(
        (key) => key.toUpperCase() === symbol
      );
      if (feedMapEntry) {
        feedId = feedMap[feedMapEntry].feedId;
      }
    }
    // Fall back to default feeds
    if (!feedId && defaultFeeds[symbol]) {
      feedId = defaultFeeds[symbol];
    }

    if (!feedId) {
      console.log(`⚠️  No feed ID found for ${symbol}, skipping`);
      continue;
    }

    pythFeedsToTest.push({ symbol, feedId });
  }

  const pythResults = [];
  if (pythFeedsToTest.length > 0) {
    for (const { symbol, feedId } of pythFeedsToTest) {
      const result = await testPythFeed(pythHttpUrl, feedId, symbol, pythStaleSecs);
      pythResults.push(result);
      
      if (result.success) {
        console.log(`  ✅ ${result.symbol}: $${result.price} (age: ${result.age}s${result.isStale ? " ⚠️  STALE" : ""})`);
      } else {
        console.log(`  ❌ ${result.symbol}: ${result.reason}`);
      }
    }
  } else {
    console.log("⚠️  No Pyth feeds configured to test\n");
  }

  // ========== TWAP Tests ==========
  console.log("\n📡 PART 2: TWAP Sanity Tests");
  console.log("-".repeat(60));

  const rpcUrl = process.env.RPC_URL;
  const twapPoolsEnv = process.env.TWAP_POOLS || "";
  const twapWindowSec = parseInt(process.env.TWAP_WINDOW_SEC || "300", 10);
  const maxDeltaPct = parseFloat(process.env.TWAP_DELTA_PCT || "0.012");
  const chainlinkFeedsEnv = process.env.CHAINLINK_FEEDS || "";

  const twapResults = [];
  
  if (!rpcUrl) {
    console.log("⚠️  RPC_URL not configured, skipping TWAP tests\n");
  } else if (!twapPoolsEnv) {
    console.log("⚠️  TWAP_POOLS not configured, skipping TWAP tests\n");
  } else {
    console.log(`RPC URL: ${rpcUrl}`);
    console.log(`TWAP Window: ${twapWindowSec}s`);
    console.log(`Max Delta: ${(maxDeltaPct * 100).toFixed(2)}%\n`);

    const twapPools = parseTwapPools(twapPoolsEnv);
    const chainlinkFeeds = parseChainlinkFeeds(chainlinkFeedsEnv);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    for (const poolConfig of twapPools) {
      const result = await testTwapPool(
        provider,
        poolConfig,
        twapWindowSec,
        chainlinkFeeds,
        maxDeltaPct
      );
      twapResults.push(result);

      if (result.success) {
        console.log(`  ✅ ${result.symbol}:`);
        console.log(`     TWAP: $${result.twapPrice.toFixed(6)} (avg tick: ${result.avgTick.toFixed(2)})`);
        console.log(`     Observation Cardinality: ${result.observationCardinality}`);
        console.log(`     Token0: ${result.token0}`);
        console.log(`     Token1: ${result.token1}`);
        console.log(`     Note: Price is token1/token0 (for WETH/USDC: USDC per WETH ≈ USD price)`);
        if (result.chainlinkPrice) {
          const status = result.withinThreshold ? "✅ PASS" : "❌ FAIL";
          console.log(`     Chainlink: $${result.chainlinkPrice.toFixed(6)} (age: ${result.chainlinkAge}s)`);
          console.log(`     Delta: ${result.deltaPct.toFixed(2)}% ${status}`);
        } else {
          console.log(`     ⚠️  No Chainlink feed configured for comparison`);
        }
      } else {
        console.log(`  ❌ ${result.symbol}: ${result.reason}${result.error ? ` (${result.error})` : ""}`);
      }
    }
  }

  // ========== Summary ==========
  console.log("\n\n✨ Integration Test Summary");
  console.log("=========================================\n");

  // Pyth summary
  const pythPassed = pythResults.filter((r) => r.success && !r.isStale).length;
  const pythStale = pythResults.filter((r) => r.success && r.isStale).length;
  const pythFailed = pythResults.filter((r) => !r.success).length;

  console.log("📡 Pyth Hermes:");
  if (pythResults.length > 0) {
    console.log(`   Total: ${pythResults.length}`);
    console.log(`   Fresh: ${pythPassed}`);
    if (pythStale > 0) {
      console.log(`   Stale: ${pythStale}`);
    }
    if (pythFailed > 0) {
      console.log(`   Failed: ${pythFailed}`);
    }
  } else {
    console.log(`   ⚠️  No tests run`);
  }

  // TWAP summary
  const twapPassed = twapResults.filter((r) => r.success && (!r.chainlinkPrice || r.withinThreshold)).length;
  const twapFailed = twapResults.filter((r) => !r.success || (r.chainlinkPrice && !r.withinThreshold)).length;

  console.log("\n📊 TWAP:");
  if (twapResults.length > 0) {
    console.log(`   Total: ${twapResults.length}`);
    console.log(`   Passed: ${twapPassed}`);
    if (twapFailed > 0) {
      console.log(`   Failed: ${twapFailed}`);
    }
  } else {
    console.log(`   ⚠️  No tests run`);
  }

  // Overall result
  const overallPass =
    pythResults.length > 0 &&
    pythPassed === pythResults.length &&
    (twapResults.length === 0 || twapPassed === twapResults.length);

  console.log();
  if (overallPass) {
    console.log("✅ All oracle tests passed");
  } else if (pythResults.length === 0 && twapResults.length === 0) {
    console.log("⚠️  No oracle tests were run - configure PYTH_ASSETS and/or TWAP_POOLS");
  } else {
    console.log("⚠️  Some oracle tests failed - review configuration and connectivity");
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
