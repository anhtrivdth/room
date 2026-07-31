import type { TelegramGateway } from "./gateway.js";
import { acceptedTripKeyboard, acceptTripKeyboard, authKeyboard, conversationErrorKeyboard, conversationKeyboard, followedGroupsKeyboard, listenerReloginKeyboard, logoutKeyboard, menuKeyboard, openMenuKeyboard, retryAuthKeyboard } from "./keyboards.js";
import { TEXT } from "./texts.js";
import { escapeHtml, renderConversationPage } from "../utils/telegram-message.js";
import { logger } from "../utils/logger.js";
import { ZaloSessionManager } from "../zalo/zalo-session-manager.js";
import type { ZaloConversation, ZaloIncomingMessage, ZaloListenerEvent, ZaloQrStatus } from "../zalo/types.js";
import { MemorySessionStore, type SessionStore, ZaloAccountAlreadyBoundError } from "../zalo/session-store.js";
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
  private readonly listenerReconnectAttempts = new Map<string, number>();
  private readonly listenerReconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly listenerAlerts = new Set<string>();
  constructor(
    private readonly sessions: ZaloSessionManager,
    private readonly store: SessionStore = new MemorySessionStore(),
    private readonly listenerReconnectDelaysMs: readonly number[] = [5_000, 15_000, 30_000],
  ) {}

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
      if (!result.zaloUserId) throw new Error("Zalo login did not return an account ID");
      this.store.saveBinding({ telegramUserId: userId, zaloUserId: result.zaloUserId, zaloDisplayName: result.displayName });
      const followedGroups = this.store.getFollowedGroups(userId, result.zaloUserId);
      this.sessions.setStatus(userId, "logged_in", {
        zaloUserId: result.zaloUserId,
        zaloDisplayName: result.displayName,
        followedGroups,
        listenerStatus: "connecting",
        listenerReconnectAttempts: 0,
      });
      await gateway.deleteMessage(qrMessageId);
      await gateway.editText(messageId, TEXT.success, markup(menuKeyboard()));
      try {
        await session.client.startMessageListener(
          (incoming) => this.handleIncomingMessage(userId, incoming, gateway),
          (event) => this.handleListenerEvent(userId, event, gateway),
        );
        logger.info("Zalo group listener started", { telegramUserId: userId });
      } catch (listenerError) {
        logger.error("Zalo group listener failed to start", listenerError);
        await gateway.sendText("⚠️ Đã đăng nhập nhưng chưa thể khởi động theo dõi tin nhắn. Vui lòng đăng nhập lại.", markup(menuKeyboard()));
      }
    } catch (error) {
      const current = this.sessions.get(userId)?.state.status;
      const expired = current === "expired";
      if (!expired) this.sessions.setStatus(userId, "error");
      const conflict = error instanceof ZaloAccountAlreadyBoundError;
      await gateway.editText(
        messageId,
        conflict ? "❌ Tài khoản Zalo này đang được liên kết với một Telegram ID khác. Vui lòng dùng tài khoản Zalo riêng." : (expired ? TEXT.expired : TEXT.failed),
        markup(retryAuthKeyboard()),
      );
      await this.sessions.remove(userId);
      logger.error("Zalo login failed", error);
    }
  }

  private handleListenerEvent(userId: string, event: ZaloListenerEvent, gateway: TelegramGateway) {
    const session = this.sessions.get(userId);
    if (!session || session.state.status !== "logged_in") return;
    if (event.type === "connected") {
      this.clearListenerRecovery(userId);
      this.listenerAlerts.delete(userId);
      this.sessions.setStatus(userId, "logged_in", {
        listenerStatus: "connected",
        listenerReconnectAttempts: 0,
        listenerConnectedAt: new Date(),
      });
      logger.info("Zalo group listener connected", { telegramUserId: userId });
      return;
    }
    if (event.type === "disconnected") {
      this.sessions.setStatus(userId, "logged_in", { listenerStatus: "reconnecting" });
      logger.info("Zalo group listener disconnected", { telegramUserId: userId, code: event.code });
      return;
    }
    if (event.type === "error") {
      logger.error("Zalo group listener error");
      return;
    }
    logger.info("Zalo group listener closed", { telegramUserId: userId, code: event.code });
    if (event.code === 3000 || event.code === 3003) {
      const reason = event.code === 3000
        ? "Zalo phát hiện một kết nối Web khác cho cùng tài khoản. Hãy đóng Zalo Web ở nơi khác rồi đăng nhập lại."
        : "Zalo đã kết thúc phiên theo dõi hiện tại.";
      void this.notifyListenerNeedsLogin(userId, gateway, reason);
      return;
    }
    this.scheduleListenerReconnect(userId, gateway);
  }

  private scheduleListenerReconnect(userId: string, gateway: TelegramGateway) {
    if (this.listenerReconnectTimers.has(userId) || !this.sessions.get(userId)) return;
    const attempt = this.listenerReconnectAttempts.get(userId) ?? 0;
    const delayMs = this.listenerReconnectDelaysMs[attempt];
    if (delayMs == null) {
      void this.notifyListenerNeedsLogin(userId, gateway, "Bot đã thử kết nối lại nhiều lần nhưng không thành công.");
      return;
    }
    this.listenerReconnectAttempts.set(userId, attempt + 1);
    this.sessions.setStatus(userId, "logged_in", { listenerStatus: "reconnecting", listenerReconnectAttempts: attempt + 1 });
    const timer = setTimeout(() => {
      this.listenerReconnectTimers.delete(userId);
      void this.restartListener(userId, gateway);
    }, delayMs);
    timer.unref?.();
    this.listenerReconnectTimers.set(userId, timer);
    logger.info("Zalo group listener reconnect scheduled", { telegramUserId: userId, attempt: attempt + 1, delayMs });
  }

  private async restartListener(userId: string, gateway: TelegramGateway) {
    const session = this.sessions.get(userId);
    if (!session || session.state.status !== "logged_in") return;
    try {
      if (!(await session.client.isAuthenticated())) {
        await this.notifyListenerNeedsLogin(userId, gateway, "Phiên đăng nhập Zalo đã hết hiệu lực.");
        return;
      }
      await session.client.restartMessageListener();
      logger.info("Zalo group listener reconnect started", { telegramUserId: userId });
    } catch (error) {
      logger.error("Zalo group listener reconnect failed", error);
      this.scheduleListenerReconnect(userId, gateway);
    }
  }

  private async notifyListenerNeedsLogin(userId: string, gateway: TelegramGateway, reason: string) {
    const session = this.sessions.get(userId);
    if (!session) return;
    this.clearListenerRecovery(userId, false);
    this.sessions.setStatus(userId, "logged_in", { listenerStatus: "needs_login" });
    if (this.listenerAlerts.has(userId)) return;
    this.listenerAlerts.add(userId);
    await gateway.sendText(
      `⚠️ KẾT NỐI THEO DÕI ZALO ĐÃ DỪNG\n\n${reason}\n\nDanh sách nhóm theo dõi của bạn đã được lưu. Đăng nhập lại đúng tài khoản Zalo để tự động khôi phục.`,
      markup(listenerReloginKeyboard()),
    ).catch((error) => logger.error("Telegram listener warning failed", error));
  }

  private clearListenerRecovery(userId: string, resetAttempts = true) {
    const timer = this.listenerReconnectTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.listenerReconnectTimers.delete(userId);
    if (resetAttempts) this.listenerReconnectAttempts.delete(userId);
  }

  async relogin(userId: string, gateway: TelegramGateway) {
    this.clearListenerRecovery(userId);
    this.listenerAlerts.delete(userId);
    await this.sessions.logout(userId);
    await this.beginLogin(userId, gateway);
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
    if (session.state.zaloUserId) this.store.addFollowedGroup(userId, session.state.zaloUserId, { id: group.id, name: group.name });
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
    if (session.state.zaloUserId) this.store.removeFollowedGroup(userId, session.state.zaloUserId, removed.id);
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
    this.clearListenerRecovery(userId);
    this.listenerAlerts.delete(userId);
    await this.sessions.logout(userId);
    await gateway.sendText(TEXT.loggedOut, markup(authKeyboard()));
  }
}
