import { describe, expect, it, vi } from "vitest";
import { BotController } from "../src/bot/bot-controller.js";
import { TEXT } from "../src/bot/texts.js";
import { ZaloSessionManager } from "../src/zalo/zalo-session-manager.js";
import { renderConversationPage } from "../src/utils/telegram-message.js";
import type { ZaloConversation } from "../src/zalo/types.js";
import { FakeGateway, MockZaloClient } from "./helpers.js";

function setup() {
  const clients = new Map<string, MockZaloClient>();
  const sessions = new ZaloSessionManager((id) => { const client = new MockZaloClient(); clients.set(id, client); return client; });
  return { clients, sessions, controller: new BotController(sessions), gateway: new FakeGateway() };
}

async function loggedInSetup() {
  const value = setup();
  const session = value.sessions.getOrCreate("1");
  (session.client as MockZaloClient).authenticated = true;
  value.sessions.setStatus("1", "logged_in");
  return value;
}

describe("/start và QR", () => {
  it("/start khi chưa đăng nhập tạo và gửi QR thật từ client", async () => {
    const { controller, gateway, clients } = setup();
    await controller.start("1", gateway);
    expect(gateway.sent[0]?.text).toBe(TEXT.loginIntro);
    expect(gateway.photos[0]?.toString()).toBe("qr");
    expect(clients.get("1")?.createQrLogin).toHaveBeenCalledOnce();
  });

  it("/start khi đã đăng nhập không tạo QR", async () => {
    const { controller, gateway, clients } = await loggedInSetup();
    await controller.start("1", gateway);
    expect(gateway.sent[0]?.text).toBe(TEXT.alreadyLoggedIn);
    expect(clients.get("1")?.createQrLogin).not.toHaveBeenCalled();
  });

  it("phản hồi lỗi tạo QR", async () => {
    const { controller, gateway, sessions } = setup();
    const client = sessions.getOrCreate("1").client as MockZaloClient;
    client.qrError = new Error("network");
    await controller.start("1", gateway);
    expect(gateway.edits.at(-1)?.text).toBe(TEXT.failed);
  });

  it("cập nhật QR hết hạn", async () => {
    const { controller, gateway, clients } = setup();
    const client = new MockZaloClient();
    client.waitForLogin = vi.fn(() => new Promise(() => undefined));
    clients.set("1", client);
    const sessions = new ZaloSessionManager(() => client);
    const localController = new BotController(sessions);
    await localController.start("1", gateway);
    client.onStatus?.("expired");
    await vi.waitFor(() => expect(gateway.edits.at(-1)?.text).toBe(TEXT.expired));
  });

  it("cập nhật đăng nhập thất bại", async () => {
    const { controller, gateway, sessions } = setup();
    const client = sessions.getOrCreate("1").client as MockZaloClient;
    client.loginError = new Error("declined");
    await controller.start("1", gateway);
    await vi.waitFor(() => expect(gateway.edits.at(-1)?.text).toBe(TEXT.failed));
  });

  it("cập nhật đã quét rồi đăng nhập thành công", async () => {
    const { controller, gateway, clients, sessions } = setup();
    const client = sessions.getOrCreate("1").client as MockZaloClient;
    let complete!: (value: import("../src/zalo/types.js").ZaloLoginResult) => void;
    client.waitForLogin = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    await controller.start("1", gateway);
    clients.get("1")?.onStatus?.("waiting_confirm");
    complete(client.loginResult);
    await vi.waitFor(() => expect(sessions.get("1")?.state.status).toBe("logged_in"));
    expect(gateway.edits.some((edit) => edit.text === TEXT.success)).toBe(true);
    expect(gateway.deleted).toEqual([101]);
  });

  it("bấm tạo QR nhiều lần không tạo nhiều phiên", async () => {
    const { controller, gateway, sessions } = setup();
    const client = sessions.getOrCreate("1").client as MockZaloClient;
    client.waitForLogin = vi.fn(() => new Promise(() => undefined));
    await controller.start("1", gateway);
    await controller.start("1", gateway);
    expect(client.createQrLogin).toHaveBeenCalledOnce();
    expect(gateway.sent.at(-1)?.text).toBe(TEXT.waitingExisting);
  });
});

describe("menu, conversations và logout", () => {
  it("/menu khi chưa đăng nhập yêu cầu đăng nhập", async () => {
    const { controller, gateway } = setup();
    await controller.menu("1", gateway);
    expect(gateway.sent[0]?.text).toBe(TEXT.notLoggedIn);
  });

  it("/menu khi đã đăng nhập hiển thị menu", async () => {
    const { controller, gateway } = await loggedInSetup();
    await controller.menu("1", gateway);
    expect(gateway.sent[0]?.text).toBe(TEXT.menu);
  });

  it("chỉ tải danh sách nhóm và bỏ ID cá nhân", async () => {
    const { controller, gateway, clients } = await loggedInSetup();
    clients.get("1")!.conversations = [
      { id: "u1", name: "Nguyễn Văn A", type: "user", lastMessage: "Alo bạn" },
      { id: "g1", name: "Nhóm tài xế", type: "group", lastMessage: "Mai chạy 7h" },
    ];
    await controller.loadConversations("1", gateway);
    expect(gateway.edits.at(-1)?.text).toContain("Nhóm tài xế");
    expect(gateway.edits.at(-1)?.text).not.toContain("Nguyễn Văn A");
  });

  it("hiển thị danh sách rỗng", async () => {
    const { controller, gateway } = await loggedInSetup();
    await controller.loadConversations("1", gateway);
    expect(gateway.edits.at(-1)?.text).toBe(TEXT.emptyConversations);
  });

  it("phân trang tối đa 8 cuộc trò chuyện", () => {
    const conversations: ZaloConversation[] = Array.from({ length: 18 }, (_, index) => ({ id: String(index), name: `Nhóm ${index}`, type: "group" }));
    const page = renderConversationPage(conversations, 1);
    expect(page.text).toContain("Nhóm 8");
    expect(page.text).toContain("Nhóm 15");
    expect(page.text).not.toContain("Nhóm 16");
    expect(page.totalPages).toBe(3);
  });

  it("cho phép chọn nhiều nhóm, không thêm trùng và lưu đúng group ID", async () => {
    const { controller, gateway, clients, sessions } = await loggedInSetup();
    clients.get("1")!.conversations = [
      { id: "group-123", name: "Nhóm vận hành", type: "group" },
      { id: "group-456", name: "Nhóm tài xế", type: "group" },
    ];
    await controller.loadConversations("1", gateway);
    await controller.selectGroup("1", 0, gateway);
    await controller.selectGroup("1", 1, gateway);
    await controller.selectGroup("1", 0, gateway);
    expect(sessions.get("1")?.state.followedGroups?.map((group) => group.id)).toEqual(["group-123", "group-456"]);
    expect(gateway.sent.at(-1)?.text).toContain("Nhóm vận hành");
  });

  it("hiển thị và loại bỏ nhóm đang theo dõi", async () => {
    const { controller, gateway, sessions } = await loggedInSetup();
    sessions.setStatus("1", "logged_in", {
      followedGroups: [
        { id: "g1", name: "Nhóm một" },
        { id: "g2", name: "Nhóm hai" },
      ],
    });
    await controller.showFollowedGroups("1", gateway);
    expect(gateway.sent.at(-1)?.text).toContain("Nhóm hai");
    await controller.removeFollowedGroup("1", 0, 99, gateway);
    expect(sessions.get("1")?.state.followedGroups).toEqual([{ id: "g2", name: "Nhóm hai" }]);
    expect(gateway.edits.at(-1)?.id).toBe(99);
    expect(gateway.edits.at(-1)?.text).not.toContain("Nhóm một");
  });

  it("xóa phiên hết hạn khi tải danh sách", async () => {
    const { controller, gateway, clients, sessions } = await loggedInSetup();
    const client = clients.get("1")!;
    client.conversationError = new Error("expired");
    client.getConversations = vi.fn(async () => { client.authenticated = false; throw client.conversationError; });
    await controller.loadConversations("1", gateway);
    expect(sessions.get("1")).toBeUndefined();
    expect(gateway.edits.at(-1)?.text).toBe(TEXT.loadFailed);
  });

  it("đăng xuất chỉ xóa đúng phiên người dùng", async () => {
    const { controller, gateway, sessions } = await loggedInSetup();
    sessions.getOrCreate("2");
    await controller.logout("1", gateway);
    expect(sessions.get("1")).toBeUndefined();
    expect(sessions.get("2")).toBeDefined();
    expect(gateway.sent.at(-1)?.text).toBe(TEXT.loggedOut);
  });

  it("hai Telegram user không dùng chung client/session", () => {
    const { sessions } = setup();
    const first = sessions.getOrCreate("1");
    const second = sessions.getOrCreate("2");
    expect(first).not.toBe(second);
    expect(first.client).not.toBe(second.client);
    expect(sessions.size()).toBe(2);
  });

  it("chỉ báo realtime từ nhóm đã theo dõi và chống gửi trùng", async () => {
    const { controller, gateway, clients, sessions } = setup();
    await controller.start("1", gateway);
    await vi.waitFor(() => expect(sessions.get("1")?.state.status).toBe("logged_in"));
    sessions.setStatus("1", "logged_in", { followedGroups: [{ id: "g1", name: "Nhóm tài xế" }] });
    const client = clients.get("1")!;
    const incoming = {
      id: "msg-1",
      groupId: "g1",
      senderId: "driver-1",
      senderName: "Tài xế A",
      text: "x4 từ Mỹ Đình sang Nội Bài 150k",
      timestamp: new Date(),
    };
    vi.useFakeTimers();
    try {
      await client.onMessage?.(incoming);
      await client.onMessage?.(incoming);
      await client.onMessage?.({ ...incoming, id: "msg-2", groupId: "g2" });
      await vi.advanceTimersByTimeAsync(12_000);
      expect(gateway.sent.filter((sent) => sent.text.includes("TIN CÓ KHẢ NĂNG LÀ CUỐC") || sent.text.includes("PHÁT HIỆN TUYẾN ĐƯỜNG"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chuyển tiếp ảnh từ nhóm đã theo dõi", async () => {
    const { controller, gateway, clients, sessions } = setup();
    await controller.start("1", gateway);
    await vi.waitFor(() => expect(sessions.get("1")?.state.status).toBe("logged_in"));
    sessions.setStatus("1", "logged_in", { followedGroups: [{ id: "g1", name: "Nhóm ảnh" }] });
    await clients.get("1")?.onMessage?.({
      id: "image-1",
      groupId: "g1",
      senderId: "u2",
      imageUrl: "https://example.com/photo.jpg",
      timestamp: new Date(),
    });
    expect(gateway.remotePhotos[0]?.url).toBe("https://example.com/photo.jpg");
  });

  it("nút Nhận trả lời ok7 đúng tin Zalo và khóa nút sau thành công", async () => {
    const { controller, gateway, clients, sessions } = setup();
    await controller.start("1", gateway);
    await vi.waitFor(() => expect(sessions.get("1")?.state.status).toBe("logged_in"));
    sessions.setStatus("1", "logged_in", { followedGroups: [{ id: "g1", name: "Nhóm nhận cuốc" }] });
    const incoming = {
      id: "claim-1", groupId: "g1", senderId: "driver", senderName: "Tài xế", text: "cần xe",
      timestamp: new Date(),
      quote: { content: "cần xe", msgType: "webchat", uidFrom: "driver", msgId: "claim-1", cliMsgId: "cli-1", ts: "1", ttl: 0 },
    };
    const client = clients.get("1")!;
    await client.onMessage?.(incoming);
    const callbackData = gateway.sent.at(-1)?.options?.reply_markup?.inline_keyboard[0]?.[0];
    expect(callbackData && "callback_data" in callbackData ? callbackData.callback_data : undefined).toMatch(/^trip:accept:[a-f0-9]{12}$/);
    const actionId = callbackData && "callback_data" in callbackData ? callbackData.callback_data.split(":").at(-1)! : "";
    await controller.acceptTrip("1", actionId, 321, gateway);
    expect(client.replyToGroupMessage).toHaveBeenCalledWith(incoming, "ok7");
    expect(gateway.editedMarkups[0]?.id).toBe(321);
    expect(gateway.editedMarkups[0]?.options.reply_markup?.inline_keyboard[0]?.[0]?.text).toBe("✅ Đã nhận");
    await controller.acceptTrip("1", actionId, 321, gateway);
    expect(client.replyToGroupMessage).toHaveBeenCalledOnce();
  });

  it("báo riêng từng tin liên tiếp, không ghép", async () => {
    const { controller, gateway, clients, sessions } = setup();
    await controller.start("1", gateway);
    await vi.waitFor(() => expect(sessions.get("1")?.state.status).toBe("logged_in"));
    sessions.setStatus("1", "logged_in", { followedGroups: [{ id: "g1", name: "Nhóm ghép tin" }] });
    const client = clients.get("1")!;
    const base = { groupId: "g1", senderId: "driver", senderName: "Tài xế", timestamp: new Date() };
    await client.onMessage?.({ ...base, id: "part-1", text: "Bệnh viện Bình Dân" });
    await client.onMessage?.({ ...base, id: "part-2", text: "Củ Chi" });
    await client.onMessage?.({ ...base, id: "part-3", text: "400k" });
    const alerts = gateway.sent.filter((sent) => sent.text.includes("NỘI DUNG GỐC"));
    expect(alerts).toHaveLength(3);
    expect(alerts.map((item) => item.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("Bệnh viện Bình Dân"),
      expect.stringContaining("Củ Chi"),
      expect.stringContaining("400k"),
    ]));
  });
});
