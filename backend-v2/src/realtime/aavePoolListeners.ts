// aavePoolListeners.ts: Subscribe to Aave Pool events and mark users dirty

import { ethers } from 'ethers';
import type { DirtyQueue } from './dirtyQueue.js';
import { getHttpProvider } from '../providers/rpc.js';
import { config } from '../config/index.js';

/**
 * Event signatures for Aave V3 Pool
 */
const EVENT_SIGNATURES = {
  Borrow: 'Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  Repay: 'Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  Supply: 'Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  Withdraw: 'Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
};

/**
 * Truncate address for logging
 */
function truncateAddress(address: string): string {
  return address.substring(0, 10) + '...';
}

/**
 * Log event trace if enabled
 * @param eventName Event name (Borrow, Repay, Supply, Withdraw)
 * @param blockNumber Block number
 * @param txHash Transaction hash
 * @param user User address
 * @param reserve Reserve address
 * @param watched Whether user is in active risk set
 */
function logEventTrace(
  eventName: string,
  blockNumber: number,
  txHash: string,
  user: string,
  reserve: string,
  watched: boolean
): void {
  // Check if event logging is enabled
  if (!config.LOG_LIVE_EVENTS) {
    return;
  }
  
  // Check if we should only log watched users
  if (config.LOG_LIVE_EVENTS_ONLY_WATCHED && !watched) {
    return;
  }
  
  console.log(
    `[event] ${eventName} block=${blockNumber} tx=${truncateAddress(txHash)} ` +
    `user=${truncateAddress(user)} reserve=${truncateAddress(reserve)} watched=${watched}`
  );
}

/**
 * AavePoolListeners manages event subscriptions to Aave Pool
 */
export class AavePoolListeners {
  private provider: ethers.JsonRpcProvider;
  private poolContract: ethers.Contract;
  private dirtyQueue: DirtyQueue;
  private activeRiskSet: Set<string>;
  private listeners: Array<() => void> = [];

  constructor(dirtyQueue: DirtyQueue, activeRiskSet: Set<string>) {
    this.provider = getHttpProvider();
    this.dirtyQueue = dirtyQueue;
    this.activeRiskSet = activeRiskSet;

    // Create pool contract instance
    this.poolContract = new ethers.Contract(
      config.AAVE_POOL_ADDRESS,
      [
        `event ${EVENT_SIGNATURES.Borrow}`,
        `event ${EVENT_SIGNATURES.Repay}`,
        `event ${EVENT_SIGNATURES.Supply}`,
        `event ${EVENT_SIGNATURES.Withdraw}`
      ],
      this.provider
    );
  }

  /**
   * Start listening to Aave Pool events
   */
  start(): void {
    console.log('[aavePool] Starting event listeners...');

    // Borrow events
    const borrowListener = (
      reserve: string, 
      user: string, 
      onBehalfOf: string, 
      amount: bigint,
      interestRateMode: number,
      borrowRate: bigint,
      referralCode: number,
      event: ethers.ContractEventPayload
    ) => {
      const affected = onBehalfOf.toLowerCase();
      const watched = this.activeRiskSet.has(affected);
      
      if (watched) {
        this.dirtyQueue.markDirty(affected);
      }
      
      // Log event trace if enabled (ethers v6: use event.log for actual Log data)
      logEventTrace(
        'Borrow',
        event.log.blockNumber,
        event.log.transactionHash,
        affected,
        reserve,
        watched
      );
    };
    this.poolContract.on('Borrow', borrowListener);
    this.listeners.push(() => this.poolContract.off('Borrow', borrowListener));

    // Repay events
    const repayListener = (
      reserve: string, 
      user: string, 
      repayer: string, 
      amount: bigint, 
      useATokens: boolean,
      event: ethers.ContractEventPayload
    ) => {
      const affected = user.toLowerCase();
      const watched = this.activeRiskSet.has(affected);
      
      if (watched) {
        this.dirtyQueue.markDirty(affected);
      }
      
      // Log event trace if enabled (ethers v6: use event.log for actual Log data)
      logEventTrace(
        'Repay',
        event.log.blockNumber,
        event.log.transactionHash,
        affected,
        reserve,
        watched
      );
    };
    this.poolContract.on('Repay', repayListener);
    this.listeners.push(() => this.poolContract.off('Repay', repayListener));

    // Supply events
    const supplyListener = (
      reserve: string, 
      user: string, 
      onBehalfOf: string, 
      amount: bigint,
      referralCode: number,
      event: ethers.ContractEventPayload
    ) => {
      const affected = onBehalfOf.toLowerCase();
      const watched = this.activeRiskSet.has(affected);
      
      if (watched) {
        this.dirtyQueue.markDirty(affected);
      }
      
      // Log event trace if enabled (ethers v6: use event.log for actual Log data)
      logEventTrace(
        'Supply',
        event.log.blockNumber,
        event.log.transactionHash,
        affected,
        reserve,
        watched
      );
    };
    this.poolContract.on('Supply', supplyListener);
    this.listeners.push(() => this.poolContract.off('Supply', supplyListener));

    // Withdraw events
    const withdrawListener = (
      reserve: string, 
      user: string, 
      to: string, 
      amount: bigint,
      event: ethers.ContractEventPayload
    ) => {
      const affected = user.toLowerCase();
      const watched = this.activeRiskSet.has(affected);
      
      if (watched) {
        this.dirtyQueue.markDirty(affected);
      }
      
      // Log event trace if enabled (ethers v6: use event.log for actual Log data)
      logEventTrace(
        'Withdraw',
        event.log.blockNumber,
        event.log.transactionHash,
        affected,
        reserve,
        watched
      );
    };
    this.poolContract.on('Withdraw', withdrawListener);
    this.listeners.push(() => this.poolContract.off('Withdraw', withdrawListener));

    console.log('[aavePool] Event listeners started (Borrow, Repay, Supply, Withdraw)');
  }

  /**
   * Stop all event listeners
   */
  stop(): void {
    console.log('[aavePool] Stopping event listeners...');
    for (const removeListener of this.listeners) {
      removeListener();
    }
    this.listeners = [];
  }
}
