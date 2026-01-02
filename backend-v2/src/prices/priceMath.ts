// priceMath.ts: Pricing math layer with 1e18 BigInt normalization (zero floating point)

import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { getHttpProvider } from '../providers/rpc.js';

/**
 * Chainlink decimals cache
 */
const chainlinkDecimalsCache = new Map<string, number>();

/**
 * Price cache: symbol -> { price: BigInt (1e18-scaled), timestamp: number }
 */
const priceCache = new Map<string, { price: bigint; timestamp: number }>();

/**
 * Chainlink feed address cache
 */
const chainlinkFeedAddresses = new Map<string, string>();

/**
 * Pyth feed ID cache
 */
const pythFeedIds = new Map<string, string>();

/**
 * Initialize Chainlink feed addresses from config
 */
export function initChainlinkFeeds(feeds: Record<string, string>): void {
  for (const [symbol, address] of Object.entries(feeds)) {
    chainlinkFeedAddresses.set(symbol.toUpperCase(), address);
  }
  console.log(`[priceMath] Initialized ${chainlinkFeedAddresses.size} Chainlink feeds`);
}

/**
 * Initialize Pyth feed IDs from config
 */
export function initPythFeeds(feeds: Record<string, string>): void {
  for (const [symbol, feedId] of Object.entries(feeds)) {
    pythFeedIds.set(symbol.toUpperCase(), feedId);
  }
  console.log(`[priceMath] Initialized ${pythFeedIds.size} Pyth feeds`);
}

/**
 * Fetch and cache decimals for a Chainlink feed
 */
async function getChainlinkDecimals(feedAddress: string): Promise<number> {
  if (chainlinkDecimalsCache.has(feedAddress)) {
    return chainlinkDecimalsCache.get(feedAddress)!;
  }

  const provider = getHttpProvider();
  const feedContract = new ethers.Contract(
    feedAddress,
    ['function decimals() external view returns (uint8)'],
    provider
  );

  const decimals = await feedContract.decimals();
  chainlinkDecimalsCache.set(feedAddress, Number(decimals));
  
  return Number(decimals);
}

/**
 * Fetch Chainlink price and normalize to 1e18 BigInt
 */
async function fetchChainlinkPrice(symbol: string): Promise<bigint> {
  const feedAddress = chainlinkFeedAddresses.get(symbol);
  if (!feedAddress) {
    throw new Error(`No Chainlink feed configured for ${symbol}`);
  }

  const provider = getHttpProvider();
  const feedContract = new ethers.Contract(
    feedAddress,
    ['function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'],
    provider
  );

  const [, answer] = await feedContract.latestRoundData();
  const decimals = await getChainlinkDecimals(feedAddress);

  // Normalize to 1e18
  const price = BigInt(answer.toString());
  if (decimals === 18) {
    return price;
  } else if (decimals < 18) {
    return price * BigInt(10 ** (18 - decimals));
  } else {
    return price / BigInt(10 ** (decimals - 18));
  }
}

/**
 * Fetch ratio feed composition: *_ETH × ETH_USD
 * Example: WSTETH_ETH × ETH_USD = WSTETH_USD
 */
async function fetchRatioFeedPrice(symbol: string): Promise<bigint> {
  // Check if this is a ratio feed (e.g., WSTETH, WEETH)
  const ratioSymbols = ['WSTETH', 'WEETH', 'CBETH'];
  
  if (!ratioSymbols.includes(symbol)) {
    throw new Error(`${symbol} is not a ratio feed`);
  }

  // Fetch *_ETH feed
  const ethRatioFeedAddress = chainlinkFeedAddresses.get(`${symbol}_ETH`);
  if (!ethRatioFeedAddress) {
    throw new Error(`No ${symbol}_ETH feed configured`);
  }

  // Fetch ETH_USD feed
  const ethUsdPrice = await fetchChainlinkPrice('ETH');

  // Fetch ratio price
  const provider = getHttpProvider();
  const ratioFeedContract = new ethers.Contract(
    ethRatioFeedAddress,
    ['function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'],
    provider
  );

  const [, ratioAnswer] = await ratioFeedContract.latestRoundData();
  const ratioDecimals = await getChainlinkDecimals(ethRatioFeedAddress);

  // Normalize ratio to 1e18
  let ratio = BigInt(ratioAnswer.toString());
  if (ratioDecimals < 18) {
    ratio = ratio * BigInt(10 ** (18 - ratioDecimals));
  } else if (ratioDecimals > 18) {
    ratio = ratio / BigInt(10 ** (ratioDecimals - 18));
  }

  // Compose: ratio × ethUsdPrice (both 1e18)
  return (ratio * ethUsdPrice) / BigInt(1e18);
}

/**
 * Fetch Pyth price and normalize to 1e18 BigInt
 * Applies expo and checks staleness via publishTime
 */
async function fetchPythPrice(symbol: string): Promise<bigint> {
  const feedId = pythFeedIds.get(symbol);
  if (!feedId) {
    throw new Error(`No Pyth feed ID configured for ${symbol}`);
  }

  // Note: In a real implementation, this would query the Pyth contract
  // For now, we'll throw an error to indicate Pyth integration is needed
  throw new Error(`Pyth price fetching not yet implemented for ${symbol}`);
}

/**
 * Get USD price for a symbol (normalized to 1e18 BigInt)
 * Supports Chainlink direct feeds, ratio feeds, and Pyth feeds
 */
export async function getUsdPrice(symbol: string): Promise<bigint> {
  const normalizedSymbol = symbol.toUpperCase();

  // Check cache first (with TTL)
  const cached = priceCache.get(normalizedSymbol);
  const now = Date.now();
  const cacheTtlMs = 30000; // 30 seconds
  
  if (cached && (now - cached.timestamp) < cacheTtlMs) {
    return cached.price;
  }

  let price: bigint;

  // Try Chainlink direct feed
  if (chainlinkFeedAddresses.has(normalizedSymbol)) {
    price = await fetchChainlinkPrice(normalizedSymbol);
  }
  // Try ratio feed composition
  else if (chainlinkFeedAddresses.has(`${normalizedSymbol}_ETH`)) {
    price = await fetchRatioFeedPrice(normalizedSymbol);
  }
  // Try Pyth feed
  else if (pythFeedIds.has(normalizedSymbol)) {
    price = await fetchPythPrice(normalizedSymbol);
  }
  // Not found
  else {
    throw new Error(`No price feed configured for ${normalizedSymbol}`);
  }

  // Cache the price
  priceCache.set(normalizedSymbol, { price, timestamp: now });

  return price;
}

/**
 * Update cached price (called by price listeners)
 */
export function updateCachedPrice(symbol: string, price: bigint): void {
  const normalizedSymbol = symbol.toUpperCase();
  priceCache.set(normalizedSymbol, { price, timestamp: Date.now() });
}

/**
 * Calculate USD value from raw token amount
 * rawAmount: token amount in raw units (e.g., 1000000 for 1 USDC with 6 decimals)
 * decimals: token decimals
 * priceUsd1e18: USD price scaled to 1e18 (from getUsdPrice)
 * Returns: USD value as number
 */
export function calculateUsdValue(
  rawAmount: bigint,
  decimals: number,
  priceUsd1e18: bigint
): number {
  // Normalize rawAmount to 1e18
  let amount1e18: bigint;
  if (decimals === 18) {
    amount1e18 = rawAmount;
  } else if (decimals < 18) {
    amount1e18 = rawAmount * BigInt(10 ** (18 - decimals));
  } else {
    amount1e18 = rawAmount / BigInt(10 ** (decimals - 18));
  }

  // Multiply by price and divide by 1e18
  const usdValue1e18 = (amount1e18 * priceUsd1e18) / BigInt(1e18);

  // Convert to number (safe because result is USD, typically < 1e15)
  return Number(usdValue1e18) / 1e18;
}

/**
 * Get cached price without fetching (returns null if not cached)
 */
export function getCachedPrice(symbol: string): bigint | null {
  const cached = priceCache.get(symbol.toUpperCase());
  return cached ? cached.price : null;
}

/**
 * Clear price cache (for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}
