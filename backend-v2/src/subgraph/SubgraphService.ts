// subgraph/SubgraphService.ts: Fetch data from Aave V3 Base subgraph
// Ported from old bot - patterns preserved

import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';
import { config } from '../config/index.js';

// Helper for numeric fields that may come as strings
const numericString = z.string().regex(/^\d+$/).transform(v => Number(v));

/**
 * Extract a valid Ethereum address from a potentially composite ID.
 * Aave subgraph reserve.id may be composite (underlyingAsset + PoolAddressesProvider).
 * This extracts the first valid 0x[a-fA-F0-9]{40} substring.
 * @param value The value to extract address from
 * @returns The extracted address or original value if no valid address found
 */
export function extractAddress(value: string): string {
  if (!value) return value;
  
  // If it's already a valid address (0x + 40 hex chars), return as-is
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value;
  }
  
  // Try to extract first valid address from composite string
  const match = value.match(/0x[0-9a-fA-F]{40}/);
  if (match) {
    return match[0];
  }
  
  // Return original value if no valid address found
  return value;
}

// Zod schemas for subgraph data
const ReserveSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.union([z.number(), numericString]).transform(v => typeof v === 'number' ? v : Number(v)),
  usageAsCollateralEnabled: z.boolean(),
});

const UserReserveSchema = z.object({
  currentATokenBalance: z.string(),
  currentVariableDebt: z.string(),
  currentStableDebt: z.string(),
  reserve: ReserveSchema,
});

const UserSchema = z.object({
  id: z.string(),
  reserves: z.array(UserReserveSchema),
});

export interface Reserve {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  usageAsCollateralEnabled: boolean;
}

export interface UserReserve {
  currentATokenBalance: string;
  currentVariableDebt: string;
  currentStableDebt: string;
  reserve: Reserve;
}

export interface User {
  id: string;
  reserves: UserReserve[];
}

export interface SubgraphServiceOptions {
  client?: Pick<GraphQLClient, 'request'>;
}

/**
 * SubgraphService: Query Aave V3 Base subgraph via The Graph Gateway
 * Ported patterns: gateway auth header mode, extractAddress, zod schemas, minimal retries
 */
export class SubgraphService {
  private client: Pick<GraphQLClient, 'request'>;

  constructor(opts: SubgraphServiceOptions = {}) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const endpoint = config.SUBGRAPH_URL;
      let headers: Record<string, string> | undefined;
      
      // Gateway auth: use header if GRAPH_API_KEY is provided
      if (config.GRAPH_API_KEY) {
        headers = { Authorization: `Bearer ${config.GRAPH_API_KEY}` };
        console.log('[subgraph] Using header auth mode');
      }
      
      const redacted = config.GRAPH_API_KEY
        ? endpoint.replaceAll(config.GRAPH_API_KEY, '****')
        : endpoint;
      console.log(`[subgraph] Using gateway URL: ${redacted}`);
      
      this.client = new GraphQLClient(endpoint, { headers });
    }
  }

  /**
   * Retry a function with exponential backoff
   */
  private async retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    const baseMs = 500;
    let lastErr: unknown;
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const backoff = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 25);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    
    throw lastErr;
  }

  /**
   * Get all reserves
   */
  async getReserves(): Promise<Reserve[]> {
    return this.retry(async () => {
      const query = gql`
        query GetReserves {
          reserves(first: 100) {
            id
            symbol
            name
            decimals
            usageAsCollateralEnabled
          }
        }
      `;
      
      const data = await this.client.request<{ reserves: unknown[] }>(query);
      return z.array(ReserveSchema).parse(data.reserves);
    });
  }

  /**
   * Get users with variable debt > 0
   */
  async getUsersWithVariableDebt(first: number, skip: number): Promise<User[]> {
    return this.retry(async () => {
      const query = gql`
        query GetUsers($first: Int!, $skip: Int!) {
          users(first: $first, skip: $skip, where: { reserves_: { currentVariableDebt_gt: "0" } }) {
            id
            reserves {
              currentATokenBalance
              currentVariableDebt
              currentStableDebt
              reserve {
                id
                symbol
                name
                decimals
                usageAsCollateralEnabled
              }
            }
          }
        }
      `;
      
      const data = await this.client.request<{ users: unknown[] }>(query, { first, skip });
      return z.array(UserSchema).parse(data.users);
    });
  }

  /**
   * Get users with stable debt > 0
   */
  async getUsersWithStableDebt(first: number, skip: number): Promise<User[]> {
    return this.retry(async () => {
      const query = gql`
        query GetUsers($first: Int!, $skip: Int!) {
          users(first: $first, skip: $skip, where: { reserves_: { currentStableDebt_gt: "0" } }) {
            id
            reserves {
              currentATokenBalance
              currentVariableDebt
              currentStableDebt
              reserve {
                id
                symbol
                name
                decimals
                usageAsCollateralEnabled
              }
            }
          }
        }
      `;
      
      const data = await this.client.request<{ users: unknown[] }>(query, { first, skip });
      return z.array(UserSchema).parse(data.users);
    });
  }

  /**
   * Get users with aToken balance > 0 (collateral holders)
   */
  async getUsersWithCollateral(first: number, skip: number): Promise<User[]> {
    return this.retry(async () => {
      const query = gql`
        query GetUsers($first: Int!, $skip: Int!) {
          users(first: $first, skip: $skip, where: { reserves_: { currentATokenBalance_gt: "0" } }) {
            id
            reserves {
              currentATokenBalance
              currentVariableDebt
              currentStableDebt
              reserve {
                id
                symbol
                name
                decimals
                usageAsCollateralEnabled
              }
            }
          }
        }
      `;
      
      const data = await this.client.request<{ users: unknown[] }>(query, { first, skip });
      return z.array(UserSchema).parse(data.users);
    });
  }
}
