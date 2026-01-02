// audit/liquidationAudit.ts: Simplified liquidation audit service
// Listens to Aave Pool LiquidationCall events and classifies missed liquidations

import { Interface, Log, WebSocketProvider } from 'ethers';
import { makeTelegram, TelegramClient } from '../notify/telegram.js';
import { getAttempts } from '../execution/attemptHistory.js';

// Aave V3 Pool LiquidationCall event ABI
const AAVE_POOL_ABI = [
  'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
];

/**
 * Simplified audit reason codes
 * Note: For PR2, keeping minimal classification. Future enhancements:
 * - 'min_debt': User debt < MIN_DEBT_USD (requires USD calculation)
 * - 'hf_above_threshold': User HF > threshold at last check (requires tracking)
 */
export type AuditReason = 
  | 'no_attempt'           // User not in active set at audit time
  | 'raced_or_reverted';   // We attempted but were raced or tx reverted

/**
 * Start liquidation audit service
 * 
 * Subscribes to LiquidationCall events on Aave Pool.
 * For each liquidation:
 * - Check if user was in our active set
 * - Classify reason why we missed it
 * - Send Telegram notification
 * 
 * @param ws WebSocket provider
 * @param poolAddress Aave V3 Pool address
 */
export function startLiquidationAudit(
  ws: WebSocketProvider,
  poolAddress: string
): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  
  // Create Telegram client if credentials available
  const tg: TelegramClient | null = (botToken && chatId) 
    ? makeTelegram(botToken, chatId)
    : null;

  if (!tg) {
    console.log('[liquidation-audit] Telegram not configured, notifications disabled');
  }

  const iface = new Interface(AAVE_POOL_ABI);
  const event = iface.getEvent('LiquidationCall');
  
  if (!event) {
    console.error('[liquidation-audit] LiquidationCall event not found in ABI');
    return;
  }

  const topic = event.topicHash;
  const filter = {
    address: poolAddress,
    topics: [topic]
  };

  console.log(`[liquidation-audit] Starting audit listener on ${poolAddress}`);

  ws.on(filter, (log: Log) => {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data
      });

      if (!parsed) return;

      // Extract event data
      const user = String(parsed.args.user).toLowerCase();
      const debtAsset = String(parsed.args.debtAsset);
      const collateralAsset = String(parsed.args.collateralAsset);
      const liquidator = String(parsed.args.liquidator);
      const txHash = log.transactionHash || 'unknown';

      // Check our attempt history for this user
      const attempts = getAttempts(user);
      
      // Classify reason
      let reason: AuditReason = 'no_attempt';
      
      if (attempts.length === 0) {
        // No attempts recorded - user not in active set or below thresholds
        reason = 'no_attempt';
      } else if (attempts.some(a => a.status === 'sent' || a.status === 'error')) {
        // We attempted but were raced or tx failed
        reason = 'raced_or_reverted';
      }

      // Build notification message
      const message = 
        `⚠️ *Liquidation Audit*\n\n` +
        `User: \`${user}\`\n` +
        `Collateral: \`${collateralAsset}\`\n` +
        `Debt: \`${debtAsset}\`\n` +
        `Liquidator: \`${liquidator}\`\n` +
        `TxHash: \`${txHash}\`\n` +
        `Block: ${log.blockNumber}\n` +
        `\n*Reason:* ${reason}\n` +
        `Attempts: ${attempts.length}`;

      console.log('[liquidation-audit] Event:', {
        user,
        collateralAsset,
        debtAsset,
        liquidator,
        txHash,
        block: log.blockNumber,
        reason,
        attemptsCount: attempts.length
      });

      // Send notification if available
      if (tg) {
        tg.send(message).catch(err => {
          console.error('[liquidation-audit] Failed to send notification:', err);
        });
      }

    } catch (err) {
      console.error('[liquidation-audit] Error processing LiquidationCall:', err);
    }
  });

  console.log('[liquidation-audit] Audit listener active');
}
