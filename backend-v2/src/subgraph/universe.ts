// subgraph/universe.ts: Universe seeding orchestration

import { SubgraphService } from './SubgraphService.js';
import { SubgraphSeeder } from './SubgraphSeeder.js';
import { config } from '../config/index.js';

export interface UniverseSeedOptions {
  maxCandidates?: number;
  pageSize?: number;
  politenessDelayMs?: number;
}

/**
 * Default maximum candidates for universe seeding
 */
export const DEFAULT_UNIVERSE_MAX_CANDIDATES = 10000;

/**
 * Seed the borrower universe from the Aave V3 Base subgraph.
 * This is the PRIMARY source of users for the active risk set.
 * 
 * Returns array of unique user addresses with any debt or collateral positions.
 */
export async function seedBorrowerUniverse(options: UniverseSeedOptions = {}): Promise<string[]> {
  console.log('[universe] Starting borrower universe seeding from subgraph...');
  
  // Determine effective max candidates: env var overrides passed option
  const effectiveMaxCandidates = config.UNIVERSE_MAX_CANDIDATES || options.maxCandidates || DEFAULT_UNIVERSE_MAX_CANDIDATES;
  const capSource = config.UNIVERSE_MAX_CANDIDATES 
    ? 'UNIVERSE_MAX_CANDIDATES' 
    : options.maxCandidates 
      ? 'passed option' 
      : 'default';
  
  console.log(`[universe] Seeding cap: ${effectiveMaxCandidates} (source: ${capSource})`);
  
  const subgraphService = new SubgraphService();
  const seeder = new SubgraphSeeder({
    subgraphService,
    maxCandidates: effectiveMaxCandidates,
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
