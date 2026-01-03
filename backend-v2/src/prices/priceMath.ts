// priceMath.ts: Pricing math layer with 1e18 BigInt normalization (zero floating point)

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';
import type { ChainlinkListener } from './ChainlinkListener.js';

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
 * Address to feed address mapping (lowercase token address -> feed address)
 * For address-first pricing without symbol() calls
 */
const addressToFeedMap = new Map<string, string>();

/**
 * Pyth feed ID cache
 */
const pythFeedIds = new Map<string, string>();

/**
 * Address to symbol mapping (lowercase address -> uppercase symbol)
 * Built at startup from ProtocolDataProvider.getAllReservesTokens()
 */
const addressToSymbolMap = new Map<string, string>();

/**
 * Token decimals cache (lowercase address -> decimals)
 */
const tokenDecimalsCache = new Map<string, number>();

/**
 * ChainlinkListener instance for cache-first price lookups
 */
let chainlinkListenerInstance: ChainlinkListener | null = null;

/**
 * Initialize Chainlink feed addresses from config
 * Implements ETH→WETH aliasing for Base network
 */
export function initChainlinkFeeds(feeds: Record<string, string>): void {
  for (const [symbol, address] of Object.entries(feeds)) {
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(
        `Invalid Chainlink feed address for ${symbol}: "${address}". ` +
        `Expected 0x-prefixed 40-character hex address. ` +
        `ENS names and other formats are not supported.`
      );
    }
    chainlinkFeedAddresses.set(symbol.toUpperCase(), address);
  }
  
  // ETH→WETH aliasing: if WETH feed exists but ETH doesn't, alias ETH to WETH
  if (chainlinkFeedAddresses.has('WETH') && !chainlinkFeedAddresses.has('ETH')) {
    const wethAddress = chainlinkFeedAddresses.get('WETH')!;
    chainlinkFeedAddresses.set('ETH', wethAddress);
    console.log(`[priceMath] Aliased ETH → WETH (${wethAddress})`);
  }
  
  console.log(`[priceMath] Initialized ${chainlinkFeedAddresses.size} Chainlink feeds`);
}

/**
 * Initialize address-to-feed mapping from config (address-first pricing)
 * @param feedsByAddress Mapping of token address to feed address
 */
export function initChainlinkFeedsByAddress(feedsByAddress: Record<string, string>): void {
  for (const [tokenAddress, feedAddress] of Object.entries(feedsByAddress)) {
    // Validate both token address and feed address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      throw new Error(
        `Invalid token address in address-to-feed mapping: "${tokenAddress}". ` +
        `Expected 0x-prefixed 40-character hex address.`
      );
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(feedAddress)) {
      throw new Error(
        `Invalid feed address for token ${tokenAddress}: "${feedAddress}". ` +
        `Expected 0x-prefixed 40-character hex address. ` +
        `ENS names and other formats are not supported.`
      );
    }
    addressToFeedMap.set(tokenAddress.toLowerCase(), feedAddress.toLowerCase());
  }
  
  console.log(`[priceMath] Initialized ${addressToFeedMap.size} address-to-feed mappings`);
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
 * Set ChainlinkListener instance for cache-first price lookups
 */
export function setChainlinkListener(listener: ChainlinkListener): void {
  chainlinkListenerInstance = listener;
  console.log('[priceMath] ChainlinkListener instance registered for cache-first lookups');
}

/**
 * Initialize address→symbol mapping from reserve tokens
 * Called at startup with results from ProtocolDataProvider.getAllReservesTokens()
 */
export function initAddressToSymbolMapping(
  reserves: Array<{ symbol: string; tokenAddress: string }>
): void {
  addressToSymbolMap.clear();
  
  for (const reserve of reserves) {
    const normalizedAddress = reserve.tokenAddress.toLowerCase();
    const normalizedSymbol = reserve.symbol.toUpperCase();
    addressToSymbolMap.set(normalizedAddress, normalizedSymbol);
  }
  
  console.log(`[priceMath] Built address→symbol mapping for ${addressToSymbolMap.size} reserves`);
}

/**
 * Cache token decimals for an address
 */
export function cacheTokenDecimals(address: string, decimals: number): void {
  tokenDecimalsCache.set(address.toLowerCase(), decimals);
}

/**
 * Get cached token decimals for an address
 */
export async function getTokenDecimals(address: string): Promise<number> {
  const normalizedAddress = address.toLowerCase();
  
  // Check cache first
  if (tokenDecimalsCache.has(normalizedAddress)) {
    return tokenDecimalsCache.get(normalizedAddress)!;
  }
  
  // Fetch from contract
  const provider = getHttpProvider();
  const tokenContract = new ethers.Contract(
    address,
    ['function decimals() external view returns (uint8)'],
    provider
  );
  
  const decimals = Number(await tokenContract.decimals());
  tokenDecimalsCache.set(normalizedAddress, decimals);
  
  return decimals;
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

  // Normalize to 1e18 using pure BigInt exponentiation
  const price = BigInt(answer.toString());
  if (decimals === 18) {
    return price;
  } else if (decimals < 18) {
    const exponent = 18 - decimals;
    return price * (10n ** BigInt(exponent));
  } else {
    const exponent = decimals - 18;
    return price / (10n ** BigInt(exponent));
  }
}

/**
 * Fetch ratio feed composition: *_ETH × ETH_USD (CACHE-FIRST)
 * Example: WSTETH_ETH × ETH_USD = WSTETH_USD
 * Uses cached prices for zero-RPC composition
 */
async function fetchRatioFeedPrice(symbol: string): Promise<bigint> {
  // Check if this is a ratio feed (e.g., WSTETH, WEETH)
  const ratioSymbols = ['WSTETH', 'WEETH', 'CBETH'];
  
  if (!ratioSymbols.includes(symbol)) {
    throw new Error(`${symbol} is not a ratio feed`);
  }

  // Get *_ETH feed address
  const ethRatioFeedAddress = chainlinkFeedAddresses.get(`${symbol}_ETH`);
  if (!ethRatioFeedAddress) {
    throw new Error(`No ${symbol}_ETH feed configured`);
  }

  // Get ETH_USD feed address
  const ethUsdFeedAddress = chainlinkFeedAddresses.get('ETH') || chainlinkFeedAddresses.get('WETH');
  if (!ethUsdFeedAddress) {
    throw new Error('No ETH/WETH feed configured for ratio composition');
  }

  // CACHE-FIRST: Try to get both prices from cache
  let ratio: bigint | null = null;
  let ethUsdPrice: bigint | null = null;

  if (chainlinkListenerInstance) {
    ratio = chainlinkListenerInstance.getCachedPrice(ethRatioFeedAddress);
    ethUsdPrice = chainlinkListenerInstance.getCachedPrice(ethUsdFeedAddress);
  }

  // If either is missing, fall back to RPC
  if (ratio === null) {
    console.warn(`[priceMath] Cache miss for ${symbol}_ETH, falling back to RPC`);
    const provider = getHttpProvider();
    const ratioFeedContract = new ethers.Contract(
      ethRatioFeedAddress,
      ['function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'],
      provider
    );

    const [, ratioAnswer] = await ratioFeedContract.latestRoundData();
    const ratioDecimals = await getChainlinkDecimals(ethRatioFeedAddress);

    // Normalize ratio to 1e18
    ratio = BigInt(ratioAnswer.toString());
    if (ratioDecimals < 18) {
      const exponent = 18 - ratioDecimals;
      ratio = ratio * (10n ** BigInt(exponent));
    } else if (ratioDecimals > 18) {
      const exponent = ratioDecimals - 18;
      ratio = ratio / (10n ** BigInt(exponent));
    }
  }

  if (ethUsdPrice === null) {
    console.warn('[priceMath] Cache miss for ETH/USD, falling back to RPC');
    ethUsdPrice = await fetchChainlinkPrice('ETH');
  }

  // Compose: ratio × ethUsdPrice (both 1e18)
  return (ratio * ethUsdPrice) / BigInt(1e18);
}

/**
 * Fetch Pyth price and normalize to 1e18 BigInt
 * Applies expo and checks staleness via publishTime
 * 
 * NOTE: This is a placeholder implementation. Full Pyth integration requires:
 * 1. Pyth contract address configuration
 * 2. Contract ABI for price queries
 * 3. Proper staleness checking via publishTime
 * 4. Expo application for normalization
 * 
 * For now, Pyth support is configured but not fully implemented.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
async function fetchPythPrice(symbol: string): Promise<bigint> {
  const feedId = pythFeedIds.get(symbol);
  if (!feedId) {
    throw new Error(`No Pyth feed ID configured for ${symbol}`);
  }

  // Placeholder: Pyth integration not yet implemented
  // To implement:
  // 1. Query Pyth contract at configured address
  // 2. Call getPriceUnsafe(bytes32 id) or similar
  // 3. Apply expo normalization: price * 10^expo
  // 4. Check publishTime for staleness
  // 5. Normalize to 1e18
  throw new Error(`Pyth price fetching not yet implemented for ${symbol}. Use Chainlink feeds instead.`);
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Get USD price for a symbol (normalized to 1e18 BigInt)
 * CACHE-FIRST: Uses in-memory prices from ChainlinkListener (zero RPC calls in normal operation)
 * Falls back to RPC only if cache miss on startup
 * Supports Chainlink direct feeds and ratio feeds
 * NOTE: Pyth is disabled in this version - use Chainlink feeds only
 */
export async function getUsdPrice(symbol: string): Promise<bigint> {
  const normalizedSymbol = symbol.toUpperCase();

  // Resolve symbol to feed address
  const feedAddress = chainlinkFeedAddresses.get(normalizedSymbol);
  
  // CACHE-FIRST: Try to get price from ChainlinkListener cache
  if (feedAddress && chainlinkListenerInstance) {
    const cachedPrice = chainlinkListenerInstance.getCachedPrice(feedAddress);
    if (cachedPrice !== null) {
      return cachedPrice; // Zero RPC calls
    }
    console.warn(`[priceMath] Cache miss for ${normalizedSymbol}, falling back to RPC`);
  }
  
  // For ratio feeds, check if they have a specific feed
  const ratioFeedAddress = chainlinkFeedAddresses.get(`${normalizedSymbol}_ETH`);
  if (ratioFeedAddress && chainlinkListenerInstance) {
    // Try cached ratio feed composition
    return fetchRatioFeedPrice(normalizedSymbol);
  }

  // Fallback: Fetch from RPC (only on startup or cache miss)
  let price: bigint;

  // Try Chainlink direct feed
  if (chainlinkFeedAddresses.has(normalizedSymbol)) {
    price = await fetchChainlinkPrice(normalizedSymbol);
  }
  // Try ratio feed composition
  else if (chainlinkFeedAddresses.has(`${normalizedSymbol}_ETH`)) {
    price = await fetchRatioFeedPrice(normalizedSymbol);
  }
  // Pyth is disabled - not supported in this version
  else {
    throw new Error(`No Chainlink price feed configured for ${normalizedSymbol}. Pyth is disabled in this version.`);
  }

  // Cache the price in local cache (for backward compatibility with TTL checks)
  const now = Date.now();
  priceCache.set(normalizedSymbol, { price, timestamp: now });

  return price;
}

/**
 * Get USD price for a token address (normalized to 1e18 BigInt)
 * CACHE-FIRST: Uses in-memory prices from ChainlinkListener (zero RPC calls in normal operation)
 * Falls back to RPC only if cache miss on startup
 * 
 * Supports:
 * - Direct feeds via address-to-feed mapping
 * - Symbol-based feeds via address→symbol→feed mapping
 * - Ratio feeds (WEETH, WSTETH, CBETH) via cached composition
 */
export async function getUsdPriceForAddress(address: string): Promise<bigint> {
  const normalizedAddress = address.toLowerCase();
  
  // Try address-to-feed mapping first (address-first pricing)
  const feedAddress = addressToFeedMap.get(normalizedAddress);
  if (feedAddress) {
    // CACHE-FIRST: Get price from ChainlinkListener cache
    if (chainlinkListenerInstance) {
      const cachedPrice = chainlinkListenerInstance.getCachedPrice(feedAddress);
      if (cachedPrice !== null) {
        return cachedPrice;
      }
      console.warn(`[priceMath] Cache miss for feed ${feedAddress}, falling back to RPC`);
    }
    
    // Fallback: Fetch from RPC (only on startup or cache miss)
    const provider = getHttpProvider();
    const feedContract = new ethers.Contract(
      feedAddress,
      ['function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'],
      provider
    );

    const [, answer] = await feedContract.latestRoundData();
    const decimals = await getChainlinkDecimals(feedAddress);

    // Normalize to 1e18 using pure BigInt exponentiation
    const price = BigInt(answer.toString());
    if (decimals === 18) {
      return price;
    } else if (decimals < 18) {
      const exponent = 18 - decimals;
      return price * (10n ** BigInt(exponent));
    } else {
      const exponent = decimals - 18;
      return price / (10n ** BigInt(exponent));
    }
  }
  
  // Fall back to address→symbol mapping (legacy path)
  const symbol = addressToSymbolMap.get(normalizedAddress);
  
  if (!symbol) {
    throw new Error(`No symbol mapping found for address ${address}. Call initAddressToSymbolMapping() at startup.`);
  }
  
  // Fetch price using symbol
  return getUsdPrice(symbol);
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
  // Normalize rawAmount to 1e18 using pure BigInt exponentiation
  let amount1e18: bigint;
  if (decimals === 18) {
    amount1e18 = rawAmount;
  } else if (decimals < 18) {
    const exponent = 18 - decimals;
    amount1e18 = rawAmount * (10n ** BigInt(exponent));
  } else {
    const exponent = decimals - 18;
    amount1e18 = rawAmount / (10n ** BigInt(exponent));
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

/**
 * Resolve ETH/USD feed address (aliased to WETH if needed)
 * Returns the configured feed address or null if not configured
 * Must be called after initChainlinkFeeds()
 */
export function resolveEthUsdFeedAddress(): string | null {
  // Try ETH first (may be aliased to WETH)
  const ethFeed = chainlinkFeedAddresses.get('ETH');
  if (ethFeed) {
    return ethFeed;
  }
  
  // Fall back to WETH
  const wethFeed = chainlinkFeedAddresses.get('WETH');
  if (wethFeed) {
    return wethFeed;
  }
  
  return null;
}

/**
 * Get normalized price from a specific feed address
 * Fetches latestRoundData() directly and normalizes to 1e18 BigInt
 * Does NOT use cache or add to cache - for warm-up only
 * @param feedAddress Chainlink feed contract address
 * @returns Normalized price as 1e18 BigInt
 */
export async function getNormalizedPriceFromFeed(feedAddress: string): Promise<bigint> {
  const provider = getHttpProvider();
  const feedContract = new ethers.Contract(
    feedAddress,
    ['function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'],
    provider
  );

  const [, answer] = await feedContract.latestRoundData();
  const decimals = await getChainlinkDecimals(feedAddress);

  // Normalize to 1e18 using pure BigInt exponentiation
  const price = BigInt(answer.toString());
  if (decimals === 18) {
    return price;
  } else if (decimals < 18) {
    const exponent = 18 - decimals;
    return price * (10n ** BigInt(exponent));
  } else {
    const exponent = decimals - 18;
    return price / (10n ** BigInt(exponent));
  }
}
