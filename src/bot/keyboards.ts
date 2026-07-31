import { Markup } from "telegraf";
import type { ZaloConversation } from "../zalo/types.js";

export const authKeyboard = () => Markup.inlineKeyboard([Markup.button.callback("🔐 Đăng nhập Zalo", "auth:new")]);
export const retryAuthKeyboard = () => Markup.inlineKeyboard([Markup.button.callback("🔄 Tạo mã QR mới", "auth:new")]);
export const listenerReloginKeyboard = () => Markup.inlineKeyboard([Markup.button.callback("🔐 Đăng nhập lại", "auth:relogin")]);
export const openMenuKeyboard = () => Markup.inlineKeyboard([Markup.button.callback("📋 Mở menu", "menu:open")]);
export const menuKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("💬 Tải danh sách trò chuyện", "conv:load")],
  [Markup.button.callback("📌 Các nhóm đang theo dõi", "groups:followed")],
  [Markup.button.callback("🚪 Đăng xuất", "logout:ask")],
]);
export const logoutKeyboard = () => Markup.inlineKeyboard([Markup.button.callback("✅ Đăng xuất", "logout:yes"), Markup.button.callback("❌ Hủy", "menu:open")]);
export const conversationErrorKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("🔄 Thử lại", "conv:load"), Markup.button.callback("🔐 Đăng nhập lại", "auth:new")],
  [Markup.button.callback("⬅️ Menu", "menu:open")],
]);

export function conversationKeyboard(
  page: number,
  totalPages: number,
  groups: ZaloConversation[] = [],
  startIndex = 0,
  followedGroupIds: ReadonlySet<string> = new Set(),
) {
  const navigation = [];
  if (page > 0) navigation.push(Markup.button.callback("⬅️ Trước", `conv:page:${page - 1}`));
  if (page + 1 < totalPages) navigation.push(Markup.button.callback("➡️ Sau", `conv:page:${page + 1}`));
  return Markup.inlineKeyboard([
    ...groups.map((group, index) => [Markup.button.callback(
      `${followedGroupIds.has(group.id) ? "✅" : "➕"} ${group.name}`.slice(0, 60),
      `group:select:${startIndex + index}`,
    )]),
    ...(navigation.length ? [navigation] : []),
    [Markup.button.callback("🔄 Tải lại", "conv:load"), Markup.button.callback("⬅️ Menu", "menu:open")],
  ]);
}

export function followedGroupsKeyboard(groups: Array<{ id: string; name: string }>) {
  return Markup.inlineKeyboard([
    ...groups.map((group, index) => [Markup.button.callback(`➖ ${group.name}`.slice(0, 60), `group:remove:${index}`)]),
    [Markup.button.callback("➕ Chọn thêm nhóm", "conv:load"), Markup.button.callback("⬅️ Menu", "menu:open")],
  ]);
}

export const acceptTripKeyboard = (actionId: string) => Markup.inlineKeyboard([
  [Markup.button.callback("✅ Nhận", `trip:accept:${actionId}`)],
]);

export const acceptedTripKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("✅ Đã nhận", "trip:accepted")],
]);
