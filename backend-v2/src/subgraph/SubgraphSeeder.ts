// subgraph/SubgraphSeeder.ts: Comprehensive user discovery via Aave V3 subgraph
// Ported from old bot - patterns preserved

import type { SubgraphService } from './SubgraphService.js';

export interface SubgraphSeederOptions {
  subgraphService: SubgraphService;
  maxCandidates?: number;
  pageSize?: number;
  politenessDelayMs?: number;
}

export interface SeederMetrics {
  totalUsers: number;
  variableDebtors: number;
  stableDebtors: number;
  collateralHolders: number;
  pagesProcessed: number;
  durationMs: number;
}

/**
 * SubgraphSeeder: Comprehensive user discovery from Aave V3 Base subgraph
 * 
 * Responsibilities:
 * - Query all users with variable debt > 0
 * - Query all users with stable debt > 0
 * - Query all users with aToken balance > 0
 * - Union and dedupe user IDs
 * - Respect pagination, retries, politeness delays
 */
export class SubgraphSeeder {
  private subgraphService: SubgraphService;
  private maxCandidates: number;
  private pageSize: number;
  private politenessDelayMs: number;

  constructor(options: SubgraphSeederOptions) {
    this.subgraphService = options.subgraphService;
    this.maxCandidates = options.maxCandidates || 10000;
    this.pageSize = options.pageSize || 1000;
    this.politenessDelayMs = options.politenessDelayMs || 100;
  }

  /**
   * Perform a complete seeding cycle: fetch all users with positions
   * @returns Array of unique user addresses
   */
  async seed(): Promise<string[]> {
    const startTime = Date.now();
    const allUsers = new Set<string>();
    let pagesProcessed = 0;
    
    console.log('[subgraph-seeder] Starting comprehensive user discovery...');
    
    try {
      // 1. Fetch users with variable debt > 0
      console.log('[subgraph-seeder] Querying users with variable debt...');
      const variableDebtors = await this.fetchUsersWithVariableDebt();
      variableDebtors.forEach(addr => allUsers.add(addr));
      pagesProcessed += Math.ceil(variableDebtors.length / this.pageSize);
      
      // Politeness delay
      await this.delay(this.politenessDelayMs);
      
      // 2. Fetch users with stable debt > 0
      console.log('[subgraph-seeder] Querying users with stable debt...');
      const stableDebtors = await this.fetchUsersWithStableDebt();
      stableDebtors.forEach(addr => allUsers.add(addr));
      pagesProcessed += Math.ceil(stableDebtors.length / this.pageSize);
      
      // Politeness delay
      await this.delay(this.politenessDelayMs);
      
      // 3. Fetch users with aToken balance > 0 (collateral holders)
      console.log('[subgraph-seeder] Querying users with collateral...');
      const collateralHolders = await this.fetchUsersWithCollateral();
      collateralHolders.forEach(addr => allUsers.add(addr));
      pagesProcessed += Math.ceil(collateralHolders.length / this.pageSize);
      
      const uniqueUsers = Array.from(allUsers);
      const durationMs = Date.now() - startTime;
      
      // Log comprehensive metrics
      console.log(
        `[subgraph-seeder] Discovery complete: ` +
        `total=${uniqueUsers.length} ` +
        `variable_debt=${variableDebtors.length} ` +
        `stable_debt=${stableDebtors.length} ` +
        `collateral=${collateralHolders.length} ` +
        `pages=${pagesProcessed} ` +
        `duration_ms=${durationMs}`
      );
      
      // Respect max candidates limit
      if (uniqueUsers.length > this.maxCandidates) {
        console.log(
          `[subgraph-seeder] Limiting to max candidates: ${this.maxCandidates} (found ${uniqueUsers.length})`
        );
        return uniqueUsers.slice(0, this.maxCandidates);
      }
      
      return uniqueUsers;
    } catch (err) {
      console.error('[subgraph-seeder] Seeding failed:', err);
      return Array.from(allUsers);
    }
  }

  /**
   * Fetch all users with variable debt > 0 (with pagination)
   */
  private async fetchUsersWithVariableDebt(): Promise<string[]> {
    return this.fetchUsersPaginated('variableDebt');
  }

  /**
   * Fetch all users with stable debt > 0 (with pagination)
   */
  private async fetchUsersWithStableDebt(): Promise<string[]> {
    return this.fetchUsersPaginated('stableDebt');
  }

  /**
   * Fetch all users with aToken balance > 0 (with pagination)
   */
  private async fetchUsersWithCollateral(): Promise<string[]> {
    return this.fetchUsersPaginated('collateral');
  }

  /**
   * Generic paginated user fetching for different position types
   */
  private async fetchUsersPaginated(type: 'variableDebt' | 'stableDebt' | 'collateral'): Promise<string[]> {
    const users: string[] = [];
    let skip = 0;
    let hasMore = true;
    
    while (hasMore && users.length < this.maxCandidates) {
      try {
        let pageUsers: { id: string }[];
        
        if (type === 'variableDebt') {
          const result = await this.subgraphService.getUsersWithVariableDebt(this.pageSize, skip);
          pageUsers = result.map(u => ({ id: u.id }));
        } else if (type === 'stableDebt') {
          const result = await this.subgraphService.getUsersWithStableDebt(this.pageSize, skip);
          pageUsers = result.map(u => ({ id: u.id }));
        } else {
          const result = await this.subgraphService.getUsersWithCollateral(this.pageSize, skip);
          pageUsers = result.map(u => ({ id: u.id }));
        }
        
        if (pageUsers.length === 0) {
          hasMore = false;
          break;
        }
        
        users.push(...pageUsers.map(u => u.id));
        skip += pageUsers.length;
        
        // Check if we got a full page - if not, we've reached the end
        if (pageUsers.length < this.pageSize) {
          hasMore = false;
        }
        
        // Politeness delay between pages
        if (hasMore) {
          await this.delay(this.politenessDelayMs);
        }
      } catch (err) {
        console.error(`[subgraph-seeder] Failed to fetch ${type} page (skip=${skip}):`, err);
        hasMore = false;
      }
    }
    
    return users;
  }

  /**
   * Delay helper for politeness
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
