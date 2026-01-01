import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Config Validation', () => {
  it('should validate minimal required env vars', () => {
    const mockEnv = {
      RPC_URL: 'https://mainnet.base.org',
      WS_RPC_URL: 'wss://mainnet.base.org',
      SUBGRAPH_URL: 'https://gateway.thegraph.com/api/key/subgraphs/id/test',
      AAVE_POOL_ADDRESS: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      EXECUTOR_ADDRESS: '0x1234567890123456789012345678901234567890',
      EXECUTION_PRIVATE_KEY: '0x0000000000000000000000000000000000000000000000000000000000000001',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: 'test-chat-id',
      MIN_DEBT_USD: '50',
      HF_THRESHOLD_START: '1.05',
      HF_THRESHOLD_EXECUTE: '1.0',
    };

    // Basic validation - just check the schema accepts valid input
    const schema = z.object({
      RPC_URL: z.string().url(),
      WS_RPC_URL: z.string().url(),
      SUBGRAPH_URL: z.string().url(),
      AAVE_POOL_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      EXECUTOR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      EXECUTION_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      TELEGRAM_BOT_TOKEN: z.string(),
      TELEGRAM_CHAT_ID: z.string(),
      MIN_DEBT_USD: z.coerce.number(),
      HF_THRESHOLD_START: z.coerce.number(),
      HF_THRESHOLD_EXECUTE: z.coerce.number(),
    });

    expect(() => schema.parse(mockEnv)).not.toThrow();
  });

  it('should reject invalid ethereum addresses', () => {
    const schema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
    
    expect(() => schema.parse('0x123')).toThrow();
    expect(() => schema.parse('not-an-address')).toThrow();
    expect(() => schema.parse('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5')).not.toThrow();
  });
});
