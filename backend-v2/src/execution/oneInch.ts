// execution/oneInch.ts: 1inch API wrapper for swap calldata generation
// Reuses patterns from old bot OneInchQuoteService

import { resolveTokenAddress } from './tokens.js';

export interface OneInchSwapRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps: number;
  fromAddress: string;
}

export interface OneInchSwapResponse {
  data: string;      // Swap calldata
  minOut: string;    // Minimum output after slippage
  to: string;        // 1inch router address
  value: string;     // Native value (usually "0" for ERC20 swaps)
}

/**
 * Get swap calldata from 1inch API
 * Supports v6 (with API key) and v5 (public fallback)
 * 
 * @param req Swap parameters
 * @returns Swap calldata and metadata
 */
export async function getOneInchSwap(req: OneInchSwapRequest): Promise<OneInchSwapResponse> {
  const apiKey = process.env.ONEINCH_API_KEY || '';
  const chainId = Number(process.env.CHAIN_ID || 8453); // Base mainnet
  
  // Determine API version and base URL
  const baseUrl = apiKey 
    ? `https://api.1inch.dev/swap/v6.0/${chainId}`
    : `https://api.1inch.exchange/v5.0/${chainId}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Resolve token addresses
  const src = resolveTokenAddress(req.fromToken);
  const dst = resolveTokenAddress(req.toToken);

  // Build query parameters (API-version specific)
  const params = new URLSearchParams(apiKey ? {
    src,
    dst,
    amount: req.amount,
    from: req.fromAddress,
    slippage: (req.slippageBps / 100).toString(),
    disableEstimate: 'true',
    allowPartialFill: 'false'
  } : {
    fromTokenAddress: src,
    toTokenAddress: dst,
    amount: req.amount,
    fromAddress: req.fromAddress,
    slippage: (req.slippageBps / 100).toString(),
    disableEstimate: 'true'
  });

  const url = `${baseUrl}/swap?${params.toString()}`;

  const resp = await fetch(url, { headers });
  
  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`1inch API error ${resp.status}: ${errorText}`);
  }

  // Note: Using 'any' for 1inch response - API schema varies between v5/v6
  // Future: Define proper interfaces for v5/v6 response types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await resp.json();

  return {
    data: data.tx?.data || data.data,
    minOut: data.dstAmount || data.toAmount || '0',
    to: data.tx?.to || data.to,
    value: data.tx?.value || data.value || '0'
  };
}
