import { Telegraf } from "telegraf";
import { BotController } from "./bot-controller.js";
import { TelegrafGateway } from "./gateway.js";

const userIdOf = (id?: number) => id == null ? undefined : String(id);

export const BOT_COMMANDS = [
  { command: "start", description: "Đăng nhập Zalo bằng mã QR" },
  { command: "menu", description: "Mở menu Zalo" },
] as const;

export function createBot(token: string, controller: BotController) {
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const userId = userIdOf(ctx.from?.id);
    if (userId) await controller.start(userId, new TelegrafGateway(ctx));
  });
  bot.command("menu", async (ctx) => {
    const userId = userIdOf(ctx.from?.id);
    if (userId) await controller.menu(userId, new TelegrafGateway(ctx));
  });

  bot.on("callback_query", async (ctx) => {
    const gateway = new TelegrafGateway(ctx);
    await gateway.answerCallback();
    const userId = userIdOf(ctx.from?.id);
    if (!userId || !("data" in ctx.callbackQuery)) return;
    const data = ctx.callbackQuery.data;
    const messageId = ctx.callbackQuery.message?.message_id;
    if (data === "auth:new") await controller.start(userId, gateway);
    else if (data === "auth:relogin") await controller.relogin(userId, gateway);
    else if (data === "menu:open") await controller.menu(userId, gateway);
    else if (data === "conv:load") await controller.loadConversations(userId, gateway);
    else if (data === "groups:followed") await controller.showFollowedGroups(userId, gateway);
    else if (data.startsWith("conv:page:") && messageId) {
      const page = Number(data.slice("conv:page:".length));
      if (Number.isSafeInteger(page) && page >= 0) await controller.showConversationPage(userId, page, messageId, gateway);
    } else if (data.startsWith("conv:item:")) await gateway.answerCallback("Chức năng xem chi tiết trò chuyện sẽ được triển khai ở giai đoạn sau.");
    else if (data.startsWith("group:select:")) {
      const index = Number(data.slice("group:select:".length));
      if (Number.isSafeInteger(index) && index >= 0) await controller.selectGroup(userId, index, gateway);
    }
    else if (data.startsWith("group:remove:")) {
      const index = Number(data.slice("group:remove:".length));
      if (Number.isSafeInteger(index) && index >= 0) await controller.removeFollowedGroup(userId, index, messageId, gateway);
    }
    else if (data.startsWith("trip:accept:")) {
      const actionId = data.slice("trip:accept:".length);
      if (/^[a-f0-9]{12}$/.test(actionId)) await controller.acceptTrip(userId, actionId, messageId, gateway);
    }
    else if (data === "logout:ask") await controller.askLogout(gateway);
    else if (data === "logout:yes") await controller.logout(userId, gateway);
  });

  bot.catch((error) => console.error("Telegram update failed", error instanceof Error ? { name: error.name, message: error.message } : "Unknown error"));
  return bot;
}
