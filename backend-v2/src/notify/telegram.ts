// notify/telegram.ts: Simple Telegram notification helper

import TelegramBot from 'node-telegram-bot-api';

export interface TelegramClient {
  send(message: string): Promise<void>;
}

/**
 * Create a Telegram notification client
 * 
 * @param botToken Telegram bot token
 * @param chatId Telegram chat ID
 * @returns Telegram client
 */
export function makeTelegram(botToken: string, chatId: string): TelegramClient {
  const bot = new TelegramBot(botToken, { polling: false });

  return {
    async send(message: string): Promise<void> {
      try {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('[telegram] Failed to send message:', err);
      }
    }
  };
}
