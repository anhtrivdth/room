import { vi } from "vitest";
import type { TelegramGateway, SendOptions } from "../src/bot/gateway.js";
import type { ZaloClient, ZaloConversation, ZaloIncomingMessage, ZaloLoginResult, ZaloQrLoginResult, ZaloQrStatus } from "../src/zalo/types.js";

export class FakeGateway implements TelegramGateway {
  sent: Array<{ id: number; text: string; options?: SendOptions }> = [];
  edits: Array<{ id: number; text: string; options?: SendOptions }> = [];
  photos: Buffer[] = [];
  deleted: number[] = [];
  answers: Array<string | undefined> = [];
  remotePhotos: Array<{ url: string; caption: string }> = [];
  editedMarkups: Array<{ id: number; options: SendOptions }> = [];
  async sendText(text: string, options?: SendOptions) { const id = this.sent.length + 1; this.sent.push({ id, text, options }); return id; }
  async sendPhoto(image: Buffer) { this.photos.push(image); return this.photos.length + 100; }
  async deleteMessage(messageId: number) { this.deleted.push(messageId); }
  async sendPhotoUrl(url: string, caption: string) { this.remotePhotos.push({ url, caption }); return this.remotePhotos.length + 200; }
  async editText(id: number, text: string, options?: SendOptions) { this.edits.push({ id, text, options }); }
  async editReplyMarkup(id: number, options: SendOptions) { this.editedMarkups.push({ id, options }); }
  async answerCallback(text?: string) { this.answers.push(text); }
}

export class MockZaloClient implements ZaloClient {
  authenticated = false;
  conversations: ZaloConversation[] = [];
  loginResult: ZaloLoginResult = { success: true, zaloUserId: "z1", displayName: "Zalo User" };
  qrError?: Error;
  loginError?: Error;
  conversationError?: Error;
  onStatus?: (status: ZaloQrStatus) => void;
  onMessage?: (message: ZaloIncomingMessage) => void | Promise<void>;
  createQrLogin = vi.fn(async (onStatus?: (status: ZaloQrStatus) => void): Promise<ZaloQrLoginResult> => {
    this.onStatus = onStatus;
    if (this.qrError) throw this.qrError;
    onStatus?.("waiting_scan");
    return { image: Buffer.from("qr"), expiresAt: new Date(Date.now() + 100_000) };
  });
  waitForLogin = vi.fn(async () => { if (this.loginError) throw this.loginError; this.authenticated = true; return this.loginResult; });
  getConversations = vi.fn(async () => { if (this.conversationError) throw this.conversationError; return this.conversations; });
  logout = vi.fn(async () => { this.authenticated = false; });
  destroy = vi.fn(async () => { this.authenticated = false; });
  isAuthenticated = vi.fn(async () => this.authenticated);
  startMessageListener = vi.fn(async (onMessage: (message: ZaloIncomingMessage) => void | Promise<void>) => { this.onMessage = onMessage; });
  stopMessageListener = vi.fn(async () => { this.onMessage = undefined; });
  replyToGroupMessage = vi.fn(async (_message: ZaloIncomingMessage, _text: string) => undefined);
}
