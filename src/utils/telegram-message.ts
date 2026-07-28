import type { ZaloConversation } from "../zalo/types.js";

export const PAGE_SIZE = 8;

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderConversationPage(conversations: ZaloConversation[], page: number) {
  const totalPages = Math.max(1, Math.ceil(conversations.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const items = conversations.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const body = items.map((conversation, index) => {
    const icon = conversation.type === "group" ? "👥" : "👤";
    const lines = [`${safePage * PAGE_SIZE + index + 1}. ${icon} <b>${escapeHtml(conversation.name)}</b>`];
    if (conversation.lastMessage) lines.push(`   Tin gần nhất: ${escapeHtml(conversation.lastMessage)}`);
    lines.push(`   ID: <code>${escapeHtml(conversation.id)}</code>`);
    return lines.join("\n");
  });
  return {
    text: `💬 <b>DANH SÁCH NHÓM ZALO</b>\n\n${body.join("\n\n")}\n\nVui lòng chọn nhóm theo dõi bên dưới.\nTrang ${safePage + 1}/${totalPages}`,
    page: safePage,
    totalPages,
    items,
    startIndex: safePage * PAGE_SIZE,
  };
}
