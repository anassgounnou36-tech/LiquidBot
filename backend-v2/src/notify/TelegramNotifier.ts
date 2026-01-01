// notify/TelegramNotifier.ts: Simple Telegram notifications

import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/index.js';

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
   * Send a notification
   */
  async notify(message: string): Promise<void> {
    if (!this.enabled || !this.bot) {
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[telegram] Failed to send notification:', err);
    }
  }

  /**
   * Send startup notification
   */
  async notifyStartup(): Promise<void> {
    const message = `🤖 *LiquidBot v2 Started*\n\nFoundation PR1: Universe seeding + oracles active`;
    await this.notify(message);
  }

  /**
   * Send liquidation alert
   */
  async notifyLiquidation(userAddress: string, healthFactor: number, blockNumber: number): Promise<void> {
    const message = 
      `⚠️ *Liquidatable User Detected*\n\n` +
      `User: \`${userAddress}\`\n` +
      `Health Factor: ${healthFactor.toFixed(4)}\n` +
      `Block: ${blockNumber}\n` +
      `\n_PR2 execution pending_`;
    
    await this.notify(message);
  }

  /**
   * Send error alert
   */
  async notifyError(error: string): Promise<void> {
    const message = `🚨 *Error*\n\n${error}`;
    await this.notify(message);
  }
}
