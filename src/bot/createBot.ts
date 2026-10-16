import { Telegraf } from "telegraf";
import { BroadcastManager } from "../admin/broadcast.js";
import { registerAdminHandlers } from "../admin/handlers.js";
import type { CacheRepository } from "../database/repositories/cache.js";
import type { DownloadsRepository } from "../database/repositories/downloads.js";
import type { SettingsRepository } from "../database/repositories/settings.js";
import type { UsersRepository } from "../database/repositories/users.js";
import { DownloadQueue } from "../services/downloadQueue.js";
import type { Downloader } from "../services/downloader.js";
import { ForceJoinService } from "../services/forceJoin.js";
import type { MtprotoUploader } from "../services/mtprotoUploader.js";
import type { RateLimiter } from "../services/rateLimiter.js";
import type { BotContext } from "../types/index.js";
import { registerDownloadHandler } from "./handlers/download.js";
import { registerHistoryHandler } from "./handlers/history.js";
import { registerStartHandler } from "./handlers/start.js";
import { registerStickerHandler } from "./handlers/sticker.js";
import { registerUser } from "./middleware/registerUser.js";
import { requireNotBanned } from "./middleware/requireNotBanned.js";

interface BotDependencies {
  token: string;
  adminIds: Set<string>;
  users: UsersRepository;
  downloads: DownloadsRepository;
  cache: CacheRepository;
  settings: SettingsRepository;
  downloader: Downloader;
  rateLimiter: RateLimiter;
  mtprotoUploader: MtprotoUploader;
}

export function createBot(dependencies: BotDependencies): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(dependencies.token);
  const broadcasts = new BroadcastManager(bot, dependencies.users, dependencies.adminIds);
  const downloadQueue = new DownloadQueue(1, 10, 1);
  const forceJoin = new ForceJoinService(dependencies.settings);

  bot.use(registerUser(dependencies.users));
  bot.use(requireNotBanned(dependencies.adminIds));
  bot.use(broadcasts.middleware());

  // 1. Register commands first so /start, /help, /history, /language, /admin are caught immediately
  let processPendingLink: ((ctx: any, lang: any, url: string) => Promise<void>) | undefined;

  registerStartHandler(bot, dependencies.users, async (ctx, lang, pendingLink) => {
    if (pendingLink && processPendingLink) {
      await processPendingLink(ctx, lang, pendingLink);
    }
  });

  registerHistoryHandler(bot, dependencies.downloads, dependencies.users, dependencies.settings);
  registerStickerHandler(bot, dependencies.adminIds, dependencies.settings);
  registerAdminHandlers(
    bot,
    dependencies.users,
    dependencies.downloads,
    dependencies.adminIds,
    broadcasts,
    dependencies.cache,
    dependencies.settings,
    downloadQueue
  );

  // 2. Register link download handler for non-command text
  processPendingLink = registerDownloadHandler(
    bot,
    dependencies.downloads,
    dependencies.downloader,
    dependencies.rateLimiter,
    downloadQueue,
    dependencies.mtprotoUploader,
    dependencies.cache,
    forceJoin,
    dependencies.adminIds,
    dependencies.users,
    dependencies.settings
  );

  bot.catch((error, ctx) => {
    console.error(`[bot] Unhandled update ${ctx.update.update_id}:`, error);
  });

  return bot;
}
