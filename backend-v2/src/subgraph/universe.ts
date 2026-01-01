// subgraph/universe.ts: Universe seeding orchestration

import { SubgraphService } from './SubgraphService.js';
import { SubgraphSeeder } from './SubgraphSeeder.js';

export interface UniverseSeedOptions {
  maxCandidates?: number;
  pageSize?: number;
  politenessDelayMs?: number;
}

/**
 * Seed the borrower universe from the Aave V3 Base subgraph.
 * This is the PRIMARY source of users for the active risk set.
 * 
 * Returns array of unique user addresses with any debt or collateral positions.
 */
export async function seedBorrowerUniverse(options: UniverseSeedOptions = {}): Promise<string[]> {
  console.log('[universe] Starting borrower universe seeding from subgraph...');
  
  const subgraphService = new SubgraphService();
  const seeder = new SubgraphSeeder({
    subgraphService,
    maxCandidates: options.maxCandidates || 10000,
    pageSize: options.pageSize || 1000,
    politenessDelayMs: options.politenessDelayMs || 100,
  });
  
  const startTime = Date.now();
  const users = await seeder.seed();
  const durationSec = (Date.now() - startTime) / 1000;
  
  console.log(
    `[universe] Seeding complete: ${users.length} unique users discovered in ${durationSec.toFixed(1)}s`
  );
  
  return users;
}
