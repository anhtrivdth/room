import type { TelegramGateway } from "./gateway.js";
import { acceptedTripKeyboard, acceptTripKeyboard, authKeyboard, conversationErrorKeyboard, conversationKeyboard, followedGroupsKeyboard, logoutKeyboard, menuKeyboard, openMenuKeyboard, retryAuthKeyboard } from "./keyboards.js";
import { TEXT } from "./texts.js";
import { escapeHtml, renderConversationPage } from "../utils/telegram-message.js";
import { logger } from "../utils/logger.js";
import { ZaloSessionManager } from "../zalo/zalo-session-manager.js";
import type { ZaloConversation, ZaloIncomingMessage, ZaloQrStatus } from "../zalo/types.js";
import { createHash, randomBytes } from "node:crypto";
import { classifyTripMessage } from "../trip-filter/trip-classifier.js";
import { renderTripAlert } from "../trip-filter/trip-alert.js";
import { tripFilterConfigFromEnv } from "../trip-filter/trip-filter.config.js";
import { TripFilterMetrics } from "../trip-filter/trip-filter-metrics.js";

const markup = (keyboard: ReturnType<typeof menuKeyboard>) => keyboard;
type TripAcceptAction = { message: ZaloIncomingMessage; createdAt: number; status: "pending" | "processing" | "done" };
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class BotController {
  private readonly operationLocks = new Set<string>();
  private readonly conversationCache = new Map<string, ZaloConversation[]>();
  private readonly seenMessageIds = new Map<string, Set<string>>();
  private readonly tripFilterConfig = tripFilterConfigFromEnv();
  private readonly tripFilterMetrics = new TripFilterMetrics();
  private readonly tripAcceptActions = new Map<string, Map<string, TripAcceptAction>>();
  constructor(private readonly sessions: ZaloSessionManager) {}

  async start(userId: string, gateway: TelegramGateway) {
    if (await this.sessions.isLoggedIn(userId)) {
      await gateway.sendText(TEXT.alreadyLoggedIn, markup(openMenuKeyboard()));
      return;
    }
    const existing = this.sessions.get(userId);
    if (existing && ["creating_qr", "waiting_scan", "waiting_confirm"].includes(existing.state.status)) {
      await gateway.sendText(TEXT.waitingExisting);
      return;
    }
    await this.beginLogin(userId, gateway);
  }

  async menu(userId: string, gateway: TelegramGateway) {
    if (!(await this.sessions.isLoggedIn(userId))) {
      await gateway.sendText(TEXT.notLoggedIn, markup(authKeyboard()));
      return;
    }
    await gateway.sendText(TEXT.menu, markup(menuKeyboard()));
  }

  async beginLogin(userId: string, gateway: TelegramGateway) {
    const lock = `auth:${userId}`;
    if (this.operationLocks.has(lock)) { await gateway.sendText(TEXT.waitingExisting); return; }
    this.operationLocks.add(lock);
    const session = this.sessions.getOrCreate(userId);
    this.sessions.setStatus(userId, "creating_qr");
    const statusMessageId = await gateway.sendText(TEXT.loginIntro);
    try {
      logger.info("Creating Zalo QR", { telegramUserId: userId });
      const qr = await withTimeout(
        session.client.createQrLogin((status) => void this.onQrStatus(userId, statusMessageId, status, gateway)),
        20_000,
        "Zalo QR generation",
      );
      this.sessions.setStatus(userId, "waiting_scan");
      logger.info("Zalo QR generated", { telegramUserId: userId, imageBytes: qr.image.byteLength });
      const qrMessageId = await withTimeout(gateway.sendPhoto(qr.image), 30_000, "Telegram QR upload");
      logger.info("Zalo QR sent", { telegramUserId: userId });
      session.authTask = this.finishLogin(userId, statusMessageId, qrMessageId, gateway);
      session.authTask.catch(() => undefined);
    } catch (error) {
      this.sessions.setStatus(userId, "error");
      await gateway.editText(statusMessageId, TEXT.failed, markup(retryAuthKeyboard()));
      await this.sessions.remove(userId);
      logger.error("Zalo QR creation failed", error);
    } finally {
      this.operationLocks.delete(lock);
    }
  }

  private async finishLogin(userId: string, messageId: number, qrMessageId: number, gateway: TelegramGateway) {
    const session = this.sessions.get(userId);
    if (!session) return;
    try {
      const result = await session.client.waitForLogin();
      this.sessions.setStatus(userId, "logged_in", { zaloUserId: result.zaloUserId, zaloDisplayName: result.displayName });
      await gateway.deleteMessage(qrMessageId);
      await gateway.editText(messageId, TEXT.success, markup(menuKeyboard()));
      try {
        await session.client.startMessageListener((incoming) => this.handleIncomingMessage(userId, incoming, gateway));
        logger.info("Zalo group listener started", { telegramUserId: userId });
      } catch (listenerError) {
        logger.error("Zalo group listener failed to start", listenerError);
        await gateway.sendText("⚠️ Đã đăng nhập nhưng chưa thể khởi động theo dõi tin nhắn. Vui lòng đăng nhập lại.", markup(menuKeyboard()));
      }
    } catch (error) {
      const current = this.sessions.get(userId)?.state.status;
      const expired = current === "expired";
      if (!expired) this.sessions.setStatus(userId, "error");
      await gateway.editText(messageId, expired ? TEXT.expired : TEXT.failed, markup(retryAuthKeyboard()));
      await this.sessions.remove(userId);
      logger.error("Zalo login failed", error);
    }
  }

  private async onQrStatus(userId: string, messageId: number, status: ZaloQrStatus, gateway: TelegramGateway) {
    if (!this.sessions.get(userId)) return;
    if (status === "waiting_confirm") {
      this.sessions.setStatus(userId, "waiting_confirm");
      await gateway.editText(messageId, TEXT.scanned);
    } else if (status === "expired") {
      this.sessions.setStatus(userId, "expired");
      await gateway.editText(messageId, TEXT.expired, markup(retryAuthKeyboard()));
    } else if (status === "declined" || status === "error") {
      this.sessions.setStatus(userId, "error");
      await gateway.editText(messageId, TEXT.failed, markup(retryAuthKeyboard()));
    }
  }

  async loadConversations(userId: string, gateway: TelegramGateway) {
    const lock = `conv:${userId}`;
    if (this.operationLocks.has(lock)) { await gateway.answerCallback("Danh sách đang được tải"); return; }
    this.operationLocks.add(lock);
    const messageId = await gateway.sendText(TEXT.loadingConversations);
    try {
      if (!(await this.sessions.isLoggedIn(userId))) { await gateway.editText(messageId, TEXT.notLoggedIn, markup(authKeyboard())); return; }
      const session = this.sessions.get(userId)!;
      const conversations = await session.client.getConversations();
      const groups = conversations.filter((conversation) => conversation.type === "group");
      this.conversationCache.set(userId, groups);
      if (!groups.length) { await gateway.editText(messageId, TEXT.emptyConversations, markup(conversationKeyboard(0, 1))); return; }
      await this.editConversationPage(userId, 0, messageId, gateway);
    } catch (error) {
      const stillAuthenticated = await this.sessions.isLoggedIn(userId);
      if (!stillAuthenticated) await this.sessions.remove(userId);
      await gateway.editText(messageId, TEXT.loadFailed, markup(conversationErrorKeyboard()));
      logger.error("Loading Zalo conversations failed", error);
    } finally { this.operationLocks.delete(lock); }
  }

  async showConversationPage(userId: string, page: number, messageId: number, gateway: TelegramGateway) {
    await this.editConversationPage(userId, page, messageId, gateway);
  }

  private async editConversationPage(userId: string, page: number, messageId: number, gateway: TelegramGateway) {
    const conversations = this.conversationCache.get(userId) ?? [];
    const rendered = renderConversationPage(conversations, page);
    const followedGroupIds = new Set(this.sessions.get(userId)?.state.followedGroups?.map((group) => group.id) ?? []);
    await gateway.editText(messageId, rendered.text, {
      ...conversationKeyboard(rendered.page, rendered.totalPages, rendered.items, rendered.startIndex, followedGroupIds),
      parse_mode: "HTML",
    });
  }

  async selectGroup(userId: string, index: number, gateway: TelegramGateway) {
    const groups = this.conversationCache.get(userId) ?? [];
    const group = groups[index];
    if (!group || group.type !== "group") {
      await gateway.answerCallback("Danh sách đã thay đổi. Vui lòng tải lại.");
      return;
    }
    const session = this.sessions.get(userId);
    if (!session || !(await this.sessions.isLoggedIn(userId))) {
      await gateway.sendText(TEXT.notLoggedIn, markup(authKeyboard()));
      return;
    }
    const followedGroups = session.state.followedGroups ?? [];
    if (followedGroups.some((followed) => followed.id === group.id)) {
      await gateway.sendText(`ℹ️ Nhóm “${group.name}” đã có trong danh sách theo dõi.`, markup(menuKeyboard()));
      return;
    }
    this.sessions.setStatus(userId, "logged_in", { followedGroups: [...followedGroups, { id: group.id, name: group.name }] });
    await gateway.sendText(
      `✅ ĐÃ THÊM NHÓM THEO DÕI\n\nNhóm: ${group.name}\nID: ${group.id}\n\nBạn có thể tiếp tục chọn thêm nhóm.`,
      markup(menuKeyboard()),
    );
  }

  async showFollowedGroups(userId: string, gateway: TelegramGateway, messageId?: number) {
    if (!(await this.sessions.isLoggedIn(userId))) {
      await gateway.sendText(TEXT.notLoggedIn, markup(authKeyboard()));
      return;
    }
    const groups = this.sessions.get(userId)?.state.followedGroups ?? [];
    const text = groups.length
      ? `📌 CÁC NHÓM ĐANG THEO DÕI\n\n${groups.map((group, index) => `${index + 1}. ${group.name}\n   ID: ${group.id}`).join("\n\n")}\n\nNhấn nút ➖ để loại bỏ nhóm.`
      : TEXT.noFollowedGroups;
    const keyboard = markup(followedGroupsKeyboard(groups));
    if (messageId) await gateway.editText(messageId, text, keyboard);
    else await gateway.sendText(text, keyboard);
  }

  async removeFollowedGroup(userId: string, index: number, messageId: number | undefined, gateway: TelegramGateway) {
    const session = this.sessions.get(userId);
    if (!session || !(await this.sessions.isLoggedIn(userId))) {
      await gateway.sendText(TEXT.notLoggedIn, markup(authKeyboard()));
      return;
    }
    const followedGroups = session.state.followedGroups ?? [];
    const removed = followedGroups[index];
    if (!removed) {
      await gateway.answerCallback("Danh sách đã thay đổi. Vui lòng mở lại.");
      return;
    }
    this.sessions.setStatus(userId, "logged_in", { followedGroups: followedGroups.filter((_, groupIndex) => groupIndex !== index) });
    await gateway.answerCallback(`Đã bỏ theo dõi ${removed.name}`);
    await this.showFollowedGroups(userId, gateway, messageId);
  }

  private async handleIncomingMessage(userId: string, message: ZaloIncomingMessage, gateway: TelegramGateway) {
    const session = this.sessions.get(userId);
    if (!session || session.state.status !== "logged_in") return;
    const group = session.state.followedGroups?.find((followed) => followed.id === message.groupId);
    if (!group) return;
    if (this.wasSeen(userId, message)) { this.tripFilterMetrics.duplicate(); return; }
    await this.processTripCandidate(userId, message, group.name, gateway, Boolean(message.imageUrl));
  }

  private async processTripCandidate(userId: string, message: ZaloIncomingMessage, groupName: string, gateway: TelegramGateway, forceImage: boolean) {
    let result = classifyTripMessage(message.text ?? "", this.tripFilterConfig.mode);
    if (forceImage && !result.shouldForward) result = { ...result, shouldForward: true, classification: "suspicious_trip", reasons: [...result.reasons, "image_message_detected"] };
    else if (this.tripFilterConfig.forwardLowScore && !result.shouldForward && result.score >= 1) result = { ...result, shouldForward: true, classification: "suspicious_trip", reasons: [...result.reasons, "low_score_forwarding_enabled"] };
    logger.info("Trip filter decision", {
      classification: result.classification,
      score: result.score,
      reasons: result.reasons,
      detectedLocationCount: result.signals.locations.length,
      hasRouteConnector: Boolean(result.signals.routeConnector),
      hasPrice: Boolean(result.signals.price),
      hasTime: Boolean(result.signals.time),
    });
    if (!result.shouldForward) { this.tripFilterMetrics.ignored(); return; }
    this.tripFilterMetrics.forwarded(result.classification);
    const alert = renderTripAlert(message, groupName, result);
    const actionId = this.storeTripAction(userId, message);
    const alertOptions = { ...acceptTripKeyboard(actionId), parse_mode: "HTML" as const };
    try {
      if (message.imageUrl) {
        try {
          await gateway.sendPhotoUrl(message.imageUrl, alert, alertOptions);
          return;
        } catch {
          await gateway.sendText(`${alert}\n\nẢnh: ${escapeHtml(message.imageUrl)}`, alertOptions);
          return;
        }
      }
      await gateway.sendText(alert, alertOptions);
    } catch (error) {
      this.tripAcceptActions.get(userId)?.delete(actionId);
      logger.error("Telegram group alert failed", error);
    }
  }

  async acceptTrip(userId: string, actionId: string, telegramMessageId: number | undefined, gateway: TelegramGateway) {
    const action = this.tripAcceptActions.get(userId)?.get(actionId);
    if (!action || Date.now() - action.createdAt > 30 * 60_000) {
      await gateway.sendText("⚠️ Tin này đã hết hạn hoặc không còn khả dụng.");
      return;
    }
    if (action.status !== "pending") return;
    if (!(await this.sessions.isLoggedIn(userId))) {
      await gateway.sendText(TEXT.notLoggedIn, markup(authKeyboard()));
      return;
    }
    action.status = "processing";
    try {
      await this.sessions.get(userId)!.client.replyToGroupMessage(action.message, "ok7");
      action.status = "done";
      if (telegramMessageId) await gateway.editReplyMarkup(telegramMessageId, markup(acceptedTripKeyboard()));
    } catch (error) {
      action.status = "pending";
      logger.error("Replying to Zalo trip message failed", error);
      await gateway.sendText("❌ Không thể trả lời tin Zalo. Vui lòng thử lại.");
    }
  }

  private storeTripAction(userId: string, message: ZaloIncomingMessage) {
    let actions = this.tripAcceptActions.get(userId);
    if (!actions) { actions = new Map(); this.tripAcceptActions.set(userId, actions); }
    const now = Date.now();
    for (const [id, action] of actions) if (now - action.createdAt > 30 * 60_000) actions.delete(id);
    while (actions.size >= 500) actions.delete(actions.keys().next().value!);
    const actionId = randomBytes(6).toString("hex");
    actions.set(actionId, { message, createdAt: now, status: "pending" });
    return actionId;
  }

  private wasSeen(userId: string, message: ZaloIncomingMessage) {
    let ids = this.seenMessageIds.get(userId);
    if (!ids) { ids = new Set(); this.seenMessageIds.set(userId, ids); }
    const normalizedHash = createHash("sha256").update((message.text ?? "").normalize("NFC").toLocaleLowerCase("vi-VN").replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
    const key = `${message.groupId}:${message.id}:${message.senderId}:${message.timestamp.getTime()}:${normalizedHash}`;
    if (ids.has(key)) return true;
    ids.add(key);
    if (ids.size > 500) ids.delete(ids.values().next().value!);
    return false;
  }

  async askLogout(gateway: TelegramGateway) { await gateway.sendText(TEXT.logoutConfirm, markup(logoutKeyboard())); }
  async logout(userId: string, gateway: TelegramGateway) {
    this.conversationCache.delete(userId);
    this.seenMessageIds.delete(userId);
    this.tripAcceptActions.delete(userId);
    await this.sessions.logout(userId);
    await gateway.sendText(TEXT.loggedOut, markup(authKeyboard()));
  }
}
