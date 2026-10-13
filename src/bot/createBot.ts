import { Telegraf } from "telegraf";
import { BroadcastManager } from "../admin/broadcast.js";
import { registerAdminHandlers } from "../admin/handlers.js";
import type { CacheRepository } from "../database/repositories/cache.js";
import type { DownloadsRepository } from "../database/repositories/downloads.js";
import type { UsersRepository } from "../database/repositories/users.js";
import { DownloadQueue } from "../services/downloadQueue.js";
import type { Downloader } from "../services/downloader.js";
import type { MtprotoUploader } from "../services/mtprotoUploader.js";
import type { RateLimiter } from "../services/rateLimiter.js";
import type { BotContext } from "../types/index.js";
import { registerDownloadHandler } from "./handlers/download.js";
import { registerHistoryHandler } from "./handlers/history.js";
import { registerStartHandler } from "./handlers/start.js";
import { registerUser } from "./middleware/registerUser.js";
import { requireNotBanned } from "./middleware/requireNotBanned.js";

interface BotDependencies {
  token: string;
  adminIds: Set<string>;
  users: UsersRepository;
  downloads: DownloadsRepository;
  cache: CacheRepository;
  downloader: Downloader;
  rateLimiter: RateLimiter;
  mtprotoUploader: MtprotoUploader;
}

export function createBot(dependencies: BotDependencies): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(dependencies.token);
  const broadcasts = new BroadcastManager(bot, dependencies.users, dependencies.adminIds);
  const downloadQueue = new DownloadQueue(1);

  // Set Telegram bot menu commands
  bot.telegram
    .setMyCommands([
      { command: "history", description: "📜 تاریخچه دانلودها" },
      { command: "language", description: "🌐 تغییر زبان / Language" }
    ])
    .catch((err) => console.warn("[bot] setMyCommands failed:", err));

  bot.use(registerUser(dependencies.users));
  bot.use(requireNotBanned(dependencies.adminIds));
  bot.use(broadcasts.middleware());

  registerStartHandler(bot, dependencies.users);
  registerHistoryHandler(bot, dependencies.downloads);
  registerAdminHandlers(
    bot,
    dependencies.users,
    dependencies.downloads,
    dependencies.adminIds,
    broadcasts,
    dependencies.cache
  );
  registerDownloadHandler(
    bot,
    dependencies.downloads,
    dependencies.downloader,
    dependencies.rateLimiter,
    downloadQueue,
    dependencies.mtprotoUploader,
    dependencies.cache
  );

  bot.catch((error, ctx) => {
    console.error(`[bot] Unhandled update ${ctx.update.update_id}:`, error);
  });

  return bot;
}
