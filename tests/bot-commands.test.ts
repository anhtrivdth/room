import { describe, expect, it } from "vitest";
import { BOT_COMMANDS } from "../src/bot/create-bot.js";

describe("Telegram bot commands", () => {
  it("giữ mô tả tiếng Việt UTF-8 chính xác", () => {
    expect(BOT_COMMANDS).toEqual([
      { command: "start", description: "Đăng nhập Zalo bằng mã QR" },
      { command: "menu", description: "Mở menu Zalo" },
    ]);
  });
});
