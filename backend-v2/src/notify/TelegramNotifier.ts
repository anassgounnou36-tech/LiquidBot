// notify/TelegramNotifier.ts: Simple Telegram notifications

import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/index.js';

/**
 * Escape HTML special characters for Telegram HTML mode
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * TelegramNotifier: Send notifications to Telegram
 */
export class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    this.chatId = config.TELEGRAM_CHAT_ID;
    this.enabled = !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);

    if (this.enabled) {
      this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
      console.log('[telegram] Notifier initialized');
    } else {
      console.log('[telegram] Notifier disabled (missing credentials)');
    }
  }

  /**
   * Send a notification with HTML formatting and fallback to plain text
   */
  async notify(message: string): Promise<void> {
    if (!this.enabled || !this.bot) {
      return;
    }

    try {
      // Try sending with HTML parse mode
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      // Fallback: send as plain text without parse_mode
      console.warn('[telegram] HTML parse failed, retrying as plain text:', err instanceof Error ? err.message : err);
      try {
        await this.bot.sendMessage(this.chatId, message);
      } catch (fallbackErr) {
        console.error('[telegram] Failed to send notification (both HTML and plain text):', fallbackErr);
      }
    }
  }

  /**
   * Send startup notification
   */
  async notifyStartup(): Promise<void> {
    const message = 
      `🤖 <b>LiquidBot v2 Started</b>\n\n` +
      `Foundation PR1: Universe seeding + oracles active`;
    await this.notify(message);
  }

  /**
   * Send liquidation alert
   */
  async notifyLiquidation(userAddress: string, healthFactor: number, blockNumber: number): Promise<void> {
    const message = 
      `⚠️ <b>Liquidatable User Detected</b>\n\n` +
      `User: <code>${escapeHtml(userAddress)}</code>\n` +
      `Health Factor: ${healthFactor.toFixed(4)}\n` +
      `Block: ${blockNumber}\n` +
      `\n<i>PR2 execution pending</i>`;
    
    await this.notify(message);
  }

  /**
   * Send error alert
   */
  async notifyError(error: string): Promise<void> {
    const message = `🚨 <b>Error</b>\n\n${escapeHtml(error)}`;
    await this.notify(message);
  }
}
