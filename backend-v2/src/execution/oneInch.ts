// oneInch.ts: 1inch swap calldata builder

/**
 * 1inch swap quote request
 */
export interface SwapQuoteRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  fromAddress: string;
  slippageBps?: number;
}

/**
 * 1inch swap quote response
 */
export interface SwapQuoteResponse {
  data: string;
  minOut: string;
  to: string;
  value: string;
}

/**
 * Build 1inch swap calldata using 1inch API
 */
export class OneInchSwapBuilder {
  private apiKey?: string;
  private chainId: number;
  private requestTimeoutMs: number;

  constructor(chainId: number = 8453, requestTimeoutMs: number = 5000) {
    this.chainId = chainId;
    this.apiKey = process.env.ONEINCH_API_KEY;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Get swap calldata from 1inch API with timeout and defensive parsing
   */
  async getSwapCalldata(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    const slippageBps = request.slippageBps || 100; // 1% default
    const slippagePercent = slippageBps / 100;

    // Build API URL
    const baseUrl = this.apiKey
      ? `https://api.1inch.dev/swap/v6.0/${this.chainId}`
      : `https://api.1inch.io/v5.0/${this.chainId}`;

    const params = new URLSearchParams({
      src: request.fromToken,
      dst: request.toToken,
      amount: request.amount,
      from: request.fromAddress,
      slippage: slippagePercent.toString(),
      disableEstimate: 'true'
    });

    const url = `${baseUrl}/swap?${params.toString()}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await fetch(url, { 
          method: 'GET', 
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`1inch API error (${response.status}): ${errorText}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await response.json() as any;

        // Defensive parsing: ensure required fields exist
        const to = data.tx?.to || data.to;
        const txData = data.tx?.data || data.data;
        const value = data.tx?.value || data.value || '0';
        const minOut = data.dstAmount || data.toAmount || '0';

        if (!to || !txData) {
          throw new Error('1inch API response missing required fields (to/data)');
        }

        if (!minOut || minOut === '0') {
          throw new Error('1inch API response missing or zero minOut (dstAmount/toAmount)');
        }

        return {
          to,
          data: txData,
          value,
          minOut
        };
      } catch (err) {
        clearTimeout(timeoutId);
        
        // Check if it's an abort error (timeout)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(`1inch API request timeout after ${this.requestTimeoutMs}ms`);
        }
        
        throw err;
      }
    } catch (err) {
      throw new Error(
        `Failed to get 1inch swap calldata: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}
