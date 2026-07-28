import type { Context } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";

export type SendOptions = { reply_markup?: InlineKeyboardMarkup; parse_mode?: "HTML" };

export interface TelegramGateway {
  sendText(text: string, options?: SendOptions): Promise<number>;
  sendPhoto(image: Buffer): Promise<number>;
  sendPhotoUrl(url: string, caption: string, options?: SendOptions): Promise<number>;
  deleteMessage(messageId: number): Promise<void>;
  editText(messageId: number, text: string, options?: SendOptions): Promise<void>;
  editReplyMarkup(messageId: number, options: SendOptions): Promise<void>;
  answerCallback(text?: string): Promise<void>;
}

export class TelegrafGateway implements TelegramGateway {
  constructor(private readonly ctx: Context) {}
  async sendText(text: string, options?: SendOptions) { const message = await this.ctx.reply(text, options); return message.message_id; }
  async sendPhoto(image: Buffer) {
    if (!this.ctx.chat) throw new Error("Cannot upload a photo without a Telegram chat");
    // Telegraf 4 uses node-fetch/form-data internally. That multipart upload can hang
    // on newer Node versions, while the native Node fetch path works reliably.
    const form = new FormData();
    form.set("chat_id", String(this.ctx.chat.id));
    form.set("photo", new Blob([Uint8Array.from(image)], { type: "image/png" }), "zalo-login-qr.png");
    const response = await fetch(`https://api.telegram.org/bot${this.ctx.telegram.token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const result = await response.json() as { ok?: boolean; result?: { message_id?: number } };
    if (!response.ok || !result.ok || !result.result?.message_id) {
      throw new Error(`Telegram photo upload failed with HTTP ${response.status}`);
    }
    return result.result.message_id;
  }
  async sendPhotoUrl(url: string, caption: string, options?: SendOptions) {
    if (!this.ctx.chat) throw new Error("Cannot send a photo without a Telegram chat");
    const response = await fetch(`https://api.telegram.org/bot${this.ctx.telegram.token}/sendPhoto`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.ctx.chat.id, photo: url, caption, parse_mode: options?.parse_mode, reply_markup: options?.reply_markup }),
    });
    const result = await response.json() as { ok?: boolean; result?: { message_id?: number } };
    if (!response.ok || !result.ok || !result.result?.message_id) throw new Error(`Telegram remote photo failed with HTTP ${response.status}`);
    return result.result.message_id;
  }
  async deleteMessage(messageId: number) {
    if (!this.ctx.chat) return;
    await this.ctx.telegram.deleteMessage(this.ctx.chat.id, messageId).catch(() => undefined);
  }
  async editText(messageId: number, text: string, options?: SendOptions) {
    if (!this.ctx.chat) return;
    await this.ctx.telegram.editMessageText(this.ctx.chat.id, messageId, undefined, text, options).catch(() => undefined);
  }
  async editReplyMarkup(messageId: number, options: SendOptions) {
    if (!this.ctx.chat) return;
    await this.ctx.telegram.editMessageReplyMarkup(this.ctx.chat.id, messageId, undefined, options.reply_markup).catch(() => undefined);
  }
  async answerCallback(text?: string) { if ("answerCbQuery" in this.ctx) await this.ctx.answerCbQuery(text).catch(() => undefined); }
}
