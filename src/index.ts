import "dotenv/config";
import { BOT_COMMANDS, createBot } from "./bot/create-bot.js";
import { BotController } from "./bot/bot-controller.js";
import { ZcaJsClient } from "./zalo/zca-client.js";
import { ZaloSessionManager } from "./zalo/zalo-session-manager.js";
import { SqliteSessionStore } from "./zalo/session-store.js";
import { resolve } from "node:path";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable");
const timeout = Number(process.env.ZALO_QR_TIMEOUT_MS ?? 110_000);
const sessions = new ZaloSessionManager(() => new ZcaJsClient(Number.isFinite(timeout) ? timeout : 110_000));
const store = new SqliteSessionStore(resolve(process.env.BOT_DATA_PATH ?? "./data/bot.sqlite"));
const bot = createBot(token, new BotController(sessions, store));

const shutdown = async (signal: "SIGINT" | "SIGTERM") => { bot.stop(signal); };
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await bot.telegram.setMyCommands([...BOT_COMMANDS]);
await bot.launch();
