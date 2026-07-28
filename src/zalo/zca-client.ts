import { LoginQRCallbackEventType, ThreadType, Zalo, type API, type ZcaMessage } from "zca-js";
import type { ZaloClient, ZaloConversation, ZaloIncomingMessage, ZaloLoginResult, ZaloQrLoginResult, ZaloQrStatus } from "./types.js";

type QrActions = { abort: () => unknown };
type LooseRecord = Record<string, unknown>;

const text = (value: unknown) => typeof value === "string" ? value : undefined;
const id = (value: unknown) => value == null ? undefined : String(value);
const numberDate = (value: unknown) => typeof value === "number" && Number.isFinite(value)
  ? new Date(value < 10_000_000_000 ? value * 1000 : value)
  : undefined;

export class ZcaJsClient implements ZaloClient {
  private api?: API;
  private loginPromise?: Promise<API>;
  private qrActions?: QrActions;
  private qrTimer?: NodeJS.Timeout;
  private displayName?: string;
  private destroyed = false;
  private messageHandler?: (message: ZcaMessage) => void;

  constructor(private readonly qrTimeoutMs = 110_000) {}

  async createQrLogin(onStatus?: (status: ZaloQrStatus) => void): Promise<ZaloQrLoginResult> {
    if (this.loginPromise) throw new Error("A QR login is already running");
    this.destroyed = false;
    let qrResolve!: (value: ZaloQrLoginResult) => void;
    let qrReject!: (reason?: unknown) => void;
    const qrPromise = new Promise<ZaloQrLoginResult>((resolve, reject) => { qrResolve = resolve; qrReject = reject; });
    const zalo = new Zalo({ logging: false });
    let receivedQr = false;

    this.loginPromise = zalo.loginQR({}, (event) => {
      if (event.actions) this.qrActions = event.actions;
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          receivedQr = true;
          onStatus?.("waiting_scan");
          this.qrTimer = setTimeout(() => {
            onStatus?.("expired");
            this.qrActions?.abort();
          }, this.qrTimeoutMs);
          qrResolve({ image: Buffer.from(event.data.image, "base64"), expiresAt: new Date(Date.now() + this.qrTimeoutMs) });
          break;
        case LoginQRCallbackEventType.QRCodeScanned:
          this.displayName = event.data.display_name;
          onStatus?.("waiting_confirm");
          break;
        case LoginQRCallbackEventType.QRCodeExpired:
          this.clearQrTimer();
          onStatus?.("expired");
          event.actions.abort();
          break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          this.clearQrTimer();
          onStatus?.("declined");
          event.actions.abort();
          break;
      }
    }).then((api) => {
      this.clearQrTimer();
      this.api = api;
      return api;
    }).catch((error: unknown) => {
      this.clearQrTimer();
      if (!receivedQr) qrReject(error);
      throw error;
    });
    this.loginPromise.catch(() => undefined);
    return qrPromise;
  }

  async waitForLogin(): Promise<ZaloLoginResult> {
    if (!this.loginPromise) throw new Error("QR login has not been started");
    const api = await this.loginPromise;
    if (this.destroyed) throw new Error("Session was destroyed");
    this.api = api;
    return { success: true, zaloUserId: String(api.getOwnId()), displayName: this.displayName };
  }

  async getConversations(): Promise<ZaloConversation[]> {
    const api = this.requireApi();
    try {
      const groupIds = await api.getAllGroups();
      const ids = this.extractGroupIds(groupIds);
      const groupInfo = ids.length ? await api.getGroupInfo(ids) : undefined;
      const groups = this.extractGroups(groupInfo, ids);
      return groups.sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0));
    } catch (error) {
      if (!(await this.isAuthenticated())) this.api = undefined;
      throw error;
    }
  }

  async startMessageListener(onMessage: (message: ZaloIncomingMessage) => void | Promise<void>) {
    const api = this.requireApi();
    if (this.messageHandler) return;
    this.messageHandler = (message) => {
      if (message.type !== ThreadType.Group || message.isSelf) return;
      const normalized = this.normalizeIncomingMessage(message);
      if (normalized) void Promise.resolve(onMessage(normalized)).catch(() => undefined);
    };
    api.listener.on("message", this.messageHandler);
    api.listener.start({ retryOnClose: true });
  }

  async stopMessageListener() {
    if (this.api && this.messageHandler) this.api.listener.off("message", this.messageHandler);
    this.api?.listener.stop();
    this.messageHandler = undefined;
  }

  async replyToGroupMessage(message: ZaloIncomingMessage, replyText: string) {
    const api = this.requireApi();
    if (!message.quote) throw new Error("Original Zalo quote payload is unavailable");
    await api.sendMessage({ msg: replyText, quote: message.quote }, message.groupId, ThreadType.Group);
  }

  async logout() { await this.stopMessageListener(); this.clearQrTimer(); this.qrActions?.abort(); this.api = undefined; this.loginPromise = undefined; this.qrActions = undefined; }
  async destroy() { this.destroyed = true; await this.logout(); }
  async isAuthenticated() {
    if (!this.api) return false;
    try { return Boolean(await this.api.fetchAccountInfo()); } catch { return false; }
  }

  private requireApi() { if (!this.api) throw new Error("Zalo session is not authenticated"); return this.api; }
  private clearQrTimer() { if (this.qrTimer) clearTimeout(this.qrTimer); this.qrTimer = undefined; }

  private normalizeIncomingMessage(message: ZcaMessage): ZaloIncomingMessage | undefined {
    const messageId = id(message.data.msgId ?? message.data.cliMsgId);
    if (!messageId || !message.threadId) return undefined;
    const content = message.data.content;
    return {
      id: messageId,
      groupId: String(message.threadId),
      senderId: String(message.data.uidFrom),
      senderName: text(message.data.dName),
      text: typeof content === "string" ? content : this.extractText(content),
      imageUrl: message.data.msgType === "chat.photo" ? this.extractImageUrl(content) : undefined,
      timestamp: numberDate(Number(message.data.ts)) ?? new Date(),
      quote: {
        content: message.data.content,
        msgType: message.data.msgType,
        propertyExt: message.data.propertyExt,
        uidFrom: message.data.uidFrom,
        msgId: message.data.msgId,
        cliMsgId: message.data.cliMsgId,
        ts: message.data.ts,
        ttl: message.data.ttl,
      },
    };
  }

  private extractText(content: Record<string, unknown>) {
    return text(content.title ?? content.description ?? content.caption ?? content.message);
  }

  private extractImageUrl(content: unknown): string | undefined {
    if (!content || typeof content !== "object") return undefined;
    const record = content as LooseRecord;
    for (const key of ["hdUrl", "oriUrl", "normalUrl", "href", "thumb", "url"]) {
      const value = text(record[key]);
      if (value?.startsWith("http")) return value;
    }
    for (const value of Object.values(record)) {
      const nested = this.extractImageUrl(value);
      if (nested) return nested;
    }
    return undefined;
  }

  private extractGroupIds(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? id((item as LooseRecord).groupId ?? (item as LooseRecord).id) : id(item)).filter(Boolean) as string[];
    if (value && typeof value === "object") {
      const record = value as LooseRecord;
      const candidates = record.groupIds ?? record.gridVerMap ?? record.groups;
      if (Array.isArray(candidates)) return candidates.map(id).filter(Boolean) as string[];
      if (candidates && typeof candidates === "object") return Object.keys(candidates);
    }
    return [];
  }

  private extractGroups(value: unknown, fallbackIds: string[]): ZaloConversation[] {
    let records: LooseRecord[] = [];
    if (Array.isArray(value)) records = value as LooseRecord[];
    else if (value && typeof value === "object") {
      const raw = (value as LooseRecord).gridInfoMap ?? (value as LooseRecord).groupInfoMap ?? value;
      if (raw && typeof raw === "object") records = Object.values(raw as LooseRecord).filter((v): v is LooseRecord => Boolean(v) && typeof v === "object");
    }
    const mapped = records.map((group) => {
      const groupId = id(group.groupId ?? group.id);
      return groupId ? { id: groupId, name: text(group.name ?? group.groupName) ?? groupId, type: "group" as const, avatarUrl: text(group.avatar ?? group.avt), lastMessage: text(group.lastMessage ?? group.lastMsg), lastActivityAt: numberDate(group.updateTime ?? group.lastActionTime) } : undefined;
    }).filter(Boolean) as ZaloConversation[];
    const known = new Set(mapped.map((group) => group.id));
    return [...mapped, ...fallbackIds.filter((groupId) => !known.has(groupId)).map((groupId) => ({ id: groupId, name: `Nhóm ${groupId}`, type: "group" as const }))];
  }
}
