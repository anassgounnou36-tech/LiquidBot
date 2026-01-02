// liquidationAudit.ts: Subscribe to LiquidationCall events and audit missed liquidations

import { ethers } from 'ethers';
import { getHttpProvider } from '../providers/rpc.js';
import { config } from '../config/index.js';
import type { TelegramNotifier } from '../notify/TelegramNotifier.js';
import type { AttemptHistory } from '../execution/attemptHistory.js';

/**
 * Audit reason classification
 */
export type AuditReason =
  | 'not_in_active_set'
  | 'debt_below_min'
  | 'hf_never_crossed'
  | 'tx_reverted_or_not_included';

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
  private activeRiskSet: Set<string>;
  private attemptHistory: AttemptHistory;
  private notifier: TelegramNotifier;
  private listener: ((...args: any[]) => void) | null = null;

  constructor(
    activeRiskSet: Set<string>,
    attemptHistory: AttemptHistory,
    notifier: TelegramNotifier
  ) {
    this.provider = getHttpProvider();
    this.activeRiskSet = activeRiskSet;
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
      receiveAToken: boolean,
      event: ethers.EventLog
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
    const { user, collateralAsset, debtAsset, debtToCover, liquidator, blockNumber, txHash } = event;

    // Check if user was in active risk set
    const inActiveSet = this.activeRiskSet.has(user);

    if (!inActiveSet) {
      // User was not in our active set - not our responsibility
      await this.sendAuditNotification(event, 'not_in_active_set', null, null, null);
      return;
    }

    // User was in active set - classify why we didn't liquidate
    const lastAttempt = this.attemptHistory.getLastAttempt(user);
    
    // Calculate debt USD (simplified - would need price service)
    const debtUsd = 0; // Placeholder - need price service integration
    
    // Check if debt was below minimum
    if (debtUsd > 0 && debtUsd < config.MIN_DEBT_USD) {
      await this.sendAuditNotification(event, 'debt_below_min', debtUsd, null, lastAttempt?.status || null);
      return;
    }

    // Check if we attempted but failed
    if (lastAttempt) {
      if (lastAttempt.status === 'sent' || lastAttempt.status === 'reverted' || lastAttempt.status === 'error') {
        await this.sendAuditNotification(event, 'tx_reverted_or_not_included', debtUsd, null, lastAttempt.status);
        return;
      }
    }

    // Default: HF never crossed execute threshold
    await this.sendAuditNotification(event, 'hf_never_crossed', debtUsd, null, null);
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
   */
  private formatAuditMessage(
    event: LiquidationEvent,
    reason: AuditReason,
    debtUsd: number | null,
    lastHF: number | null,
    attemptStatus: string | null
  ): string {
    const userShort = `${event.user.substring(0, 6)}...${event.user.substring(38)}`;
    const collateralShort = `${event.collateralAsset.substring(0, 6)}...${event.collateralAsset.substring(38)}`;
    const debtShort = `${event.debtAsset.substring(0, 6)}...${event.debtAsset.substring(38)}`;
    const liquidatorShort = `${event.liquidator.substring(0, 6)}...${event.liquidator.substring(38)}`;
    const txLink = `https://basescan.org/tx/${event.txHash}`;

    let reasonText = '';
    switch (reason) {
      case 'not_in_active_set':
        reasonText = '❌ User not in active risk set';
        break;
      case 'debt_below_min':
        reasonText = `💰 Debt below MIN_DEBT_USD (${config.MIN_DEBT_USD})`;
        break;
      case 'hf_never_crossed':
        reasonText = '📊 HF never crossed execute threshold';
        break;
      case 'tx_reverted_or_not_included':
        reasonText = `🔄 We attempted but ${attemptStatus || 'failed'}`;
        break;
    }

    const debtUsdStr = debtUsd !== null ? `$${debtUsd.toFixed(2)}` : 'N/A';
    const lastHFStr = lastHF !== null ? lastHF.toFixed(4) : 'N/A';

    return `🔍 **[Liquidation Audit]**

👤 User: \`${userShort}\`
💎 Collateral: \`${collateralShort}\`
💰 Debt: \`${debtShort}\`
🔢 Debt USD: ${debtUsdStr}
👤 Liquidator: \`${liquidatorShort}\`
🔗 [Tx](${txLink})
📦 Block: ${event.blockNumber}

📊 Reason: ${reasonText}
${lastHF !== null ? `❤️ Last HF: ${lastHFStr}` : ''}`;
  }
}
