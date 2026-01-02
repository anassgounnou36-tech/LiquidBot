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

  constructor(chainId: number = 8453) {
    this.chainId = chainId;
    this.apiKey = process.env.ONEINCH_API_KEY;
  }

  /**
   * Get swap calldata from 1inch API
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
      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`1inch API error (${response.status}): ${errorText}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as any;

      return {
        to: data.tx?.to || data.to,
        data: data.tx?.data || data.data,
        value: data.tx?.value || data.value || '0',
        minOut: data.dstAmount || data.toAmount || '0'
      };
    } catch (err) {
      throw new Error(
        `Failed to get 1inch swap calldata: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}
