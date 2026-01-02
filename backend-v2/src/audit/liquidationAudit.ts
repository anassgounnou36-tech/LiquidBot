// liquidationAudit.ts: Subscribe to LiquidationCall events and audit missed liquidations

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';
import { config } from '../config/index.js';
import type { TelegramNotifier } from '../notify/TelegramNotifier.js';
import type { AttemptHistory } from '../execution/attemptHistory.js';
import type { ActiveRiskSet } from '../risk/ActiveRiskSet.js';

/**
 * Audit reason classification
 */
export type AuditReason =
  | 'not_in_active_set'
  | 'debt_below_min'
  | 'hf_never_crossed_execute'
  | 'attempt_failed_or_late'
  | 'priced_out';

/**
 * Liquidation event data
 */
export interface LiquidationEvent {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  liquidatedCollateralAmount: bigint;
  liquidator: string;
  blockNumber: number;
  txHash: string;
}

/**
 * LiquidationAudit monitors LiquidationCall events and classifies missed opportunities
 */
export class LiquidationAudit {
  private provider: ethers.JsonRpcProvider;
  private poolContract: ethers.Contract;
  private activeRiskSetRef: ActiveRiskSet;
  private activeRiskSet: Set<string>;
  private attemptHistory: AttemptHistory;
  private notifier: TelegramNotifier;
  private listener: ((...args: any[]) => void) | null = null;

  constructor(
    activeRiskSet: Set<string>,
    activeRiskSetRef: ActiveRiskSet,
    attemptHistory: AttemptHistory,
    notifier: TelegramNotifier
  ) {
    this.provider = getHttpProvider();
    this.activeRiskSet = activeRiskSet;
    this.activeRiskSetRef = activeRiskSetRef;
    this.attemptHistory = attemptHistory;
    this.notifier = notifier;

    // Create pool contract instance
    this.poolContract = new ethers.Contract(
      config.AAVE_POOL_ADDRESS,
      [
        'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
      ],
      this.provider
    );
  }

  /**
   * Start listening to LiquidationCall events
   */
  start(): void {
    console.log('[audit] Starting LiquidationCall listener...');

    this.listener = (
      collateralAsset: string,
      debtAsset: string,
      user: string,
      debtToCover: bigint,
      liquidatedCollateralAmount: bigint,
      liquidator: string,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      receiveAToken: boolean,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: any
    ) => {
      const liquidationEvent: LiquidationEvent = {
        user: user.toLowerCase(),
        collateralAsset: collateralAsset.toLowerCase(),
        debtAsset: debtAsset.toLowerCase(),
        debtToCover,
        liquidatedCollateralAmount,
        liquidator: liquidator.toLowerCase(),
        blockNumber: event.blockNumber,
        txHash: event.transactionHash
      };

      this.handleLiquidation(liquidationEvent).catch(err => {
        console.error('[audit] Error handling liquidation:', err);
      });
    };

    this.poolContract.on('LiquidationCall', this.listener);
    console.log('[audit] LiquidationCall listener started');
  }

  /**
   * Stop listening
   */
  stop(): void {
    if (this.listener) {
      this.poolContract.off('LiquidationCall', this.listener);
      this.listener = null;
      console.log('[audit] LiquidationCall listener stopped');
    }
  }

  /**
   * Handle a liquidation event
   */
  private async handleLiquidation(event: LiquidationEvent): Promise<void> {
    const { user } = event;

    // Check if user was in active risk set
    const inActiveSet = this.activeRiskSet.has(user);

    if (!inActiveSet) {
      // User was not in our active set - not our responsibility
      await this.sendAuditNotification(event, 'not_in_active_set', null, null, null);
      return;
    }

    // User was in active set - get their last known data
    const userData = this.activeRiskSetRef.get(user);
    const lastHF = userData?.healthFactor || null;
    const lastDebtUsd1e18 = userData?.lastDebtUsd1e18 || null;
    
    // Convert debtUsd1e18 to display number (only for display, comparisons use BigInt)
    const lastDebtUsd = lastDebtUsd1e18 ? Number(lastDebtUsd1e18) / 1e18 : null;
    
    // Check if debt was below minimum (use BigInt for comparison)
    const minDebtUsd1e18 = BigInt(Math.floor(config.MIN_DEBT_USD)) * (10n ** 18n);
    if (lastDebtUsd1e18 !== null && lastDebtUsd1e18 < minDebtUsd1e18) {
      await this.sendAuditNotification(event, 'debt_below_min', lastDebtUsd, lastHF, null);
      return;
    }

    // Check if we attempted
    const lastAttempt = this.attemptHistory.getLastAttempt(user);
    if (lastAttempt) {
      // Check if attempt failed due to safety checks (priced_out)
      if (lastAttempt.status === 'error' && lastAttempt.error?.includes('Safety check failed')) {
        await this.sendAuditNotification(event, 'priced_out', lastDebtUsd, lastHF, 'safety_check');
        return;
      }
      
      // Check if attempt is pending (sent but not mined) - this is NOT a failure
      if (lastAttempt.status === 'sent') {
        await this.sendAuditNotification(event, 'attempt_failed_or_late', lastDebtUsd, lastHF, 'pending_late_inclusion');
        return;
      }
      
      // Check if attempt failed or reverted
      if (lastAttempt.status === 'reverted' || lastAttempt.status === 'error') {
        await this.sendAuditNotification(event, 'attempt_failed_or_late', lastDebtUsd, lastHF, lastAttempt.status);
        return;
      }
    }

    // Default: HF never crossed execute threshold
    await this.sendAuditNotification(event, 'hf_never_crossed_execute', lastDebtUsd, lastHF, null);
  }

  /**
   * Send audit notification via Telegram
   */
  private async sendAuditNotification(
    event: LiquidationEvent,
    reason: AuditReason,
    debtUsd: number | null,
    lastHF: number | null,
    attemptStatus: string | null
  ): Promise<void> {
    const message = this.formatAuditMessage(event, reason, debtUsd, lastHF, attemptStatus);
    
    try {
      await this.notifier.notify(message);
    } catch (err) {
      console.error('[audit] Failed to send notification:', err);
    }
  }

  /**
   * Format audit message for Telegram
   * Includes all required fields: user, debt/collateral assets, lastHF, lastDebtUsd, reason, liquidator txHash
   */
  private formatAuditMessage(
    event: LiquidationEvent,
    reason: AuditReason,
    debtUsd: number | null,
    lastHF: number | null,
    attemptStatus: string | null
  ): string {
    const userShort = `${event.user.substring(0, 6)}...${event.user.substring(38)}`;
    const collateralShort = `${event.collateralAsset.substring(0, 10)}...`;
    const debtShort = `${event.debtAsset.substring(0, 10)}...`;
    const liquidatorShort = `${event.liquidator.substring(0, 6)}...${event.liquidator.substring(38)}`;
    const txLink = `https://basescan.org/tx/${event.txHash}`;

    let reasonText = '';
    switch (reason) {
      case 'not_in_active_set':
        reasonText = '❌ User not in active risk set';
        break;
      case 'debt_below_min':
        reasonText = `💰 Debt below MIN_DEBT_USD ($${config.MIN_DEBT_USD})`;
        break;
      case 'hf_never_crossed_execute':
        reasonText = `📊 HF never crossed execute threshold (${config.HF_THRESHOLD_EXECUTE})`;
        break;
      case 'attempt_failed_or_late':
        if (attemptStatus === 'pending_late_inclusion') {
          reasonText = `⏳ We attempted but pending / late inclusion`;
        } else {
          reasonText = `🔄 We attempted but ${attemptStatus || 'failed'}`;
        }
        break;
      case 'priced_out':
        reasonText = `💸 Priced out: minOut or safety checks failed`;
        break;
    }

    // Display debtUsd as number only (not 1e18 BigInt)
    const debtUsdStr = debtUsd !== null ? debtUsd.toFixed(2) : 'N/A';
    const lastHFStr = lastHF !== null ? lastHF.toFixed(4) : 'N/A';

    return `🔍 **[Liquidation Audit]**

👤 User: \`${userShort}\`
💎 Collateral Asset: \`${collateralShort}\`
💰 Debt Asset: \`${debtShort}\`
💵 Last Debt USD: $${debtUsdStr}
❤️ Last HF: ${lastHFStr}
🏦 Liquidator: \`${liquidatorShort}\`
🔗 [Transaction](${txLink})
📦 Block: ${event.blockNumber}

📊 Reason: ${reasonText}`;
  }
}
