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
    const borrowListener = (reserve: string, user: string, onBehalfOf: string) => {
      const affected = onBehalfOf.toLowerCase();
      if (this.activeRiskSet.has(affected)) {
        this.dirtyQueue.markDirty(affected);
      }
    };
    this.poolContract.on('Borrow', borrowListener);
    this.listeners.push(() => this.poolContract.off('Borrow', borrowListener));

    // Repay events
    const repayListener = (reserve: string, user: string) => {
      const affected = user.toLowerCase();
      if (this.activeRiskSet.has(affected)) {
        this.dirtyQueue.markDirty(affected);
      }
    };
    this.poolContract.on('Repay', repayListener);
    this.listeners.push(() => this.poolContract.off('Repay', repayListener));

    // Supply events
    const supplyListener = (reserve: string, user: string, onBehalfOf: string) => {
      const affected = onBehalfOf.toLowerCase();
      if (this.activeRiskSet.has(affected)) {
        this.dirtyQueue.markDirty(affected);
      }
    };
    this.poolContract.on('Supply', supplyListener);
    this.listeners.push(() => this.poolContract.off('Supply', supplyListener));

    // Withdraw events
    const withdrawListener = (reserve: string, user: string) => {
      const affected = user.toLowerCase();
      if (this.activeRiskSet.has(affected)) {
        this.dirtyQueue.markDirty(affected);
      }
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
