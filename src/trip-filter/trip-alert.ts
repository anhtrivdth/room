import type { ZaloIncomingMessage } from "../zalo/types.js";
import type { TripClassificationResult } from "./trip-filter.types.js";
import { escapeHtml } from "../utils/telegram-message.js";

export function renderTripAlert(message: ZaloIncomingMessage, groupName: string, result: TripClassificationResult) {
  const heading = result.classification === "route_candidate" ? "🛣 PHÁT HIỆN TUYẾN ĐƯỜNG" : "🚕 TIN CÓ KHẢ NĂNG LÀ CUỐC";
  const safe = (value: string) => escapeHtml(value);
  const lines = [`<b>${heading}</b>`, "", `Nhóm: <b>${safe(groupName)}</b>`, `Người gửi: <b>${safe(message.senderName ?? message.senderId)}</b>`];
  if (message.text) {
    const original = message.text.length > 3_000 ? `${message.text.slice(0, 3_000)}…` : message.text;
    lines.push("", "<b>📣 NỘI DUNG GỐC</b>", `<blockquote><b>${safe(original)}</b></blockquote>`);
  }
  return lines.join("\n");
}
