import http from "node:http";
import { createBot } from "./bot/createBot.js";
import { registerBotCommandsAndMenu } from "./bot/commands.js";
import { config } from "./config.js";
import { createDatabase } from "./database/client.js";
import { CacheRepository } from "./database/repositories/cache.js";
import { DownloadsRepository } from "./database/repositories/downloads.js";
import { SettingsRepository } from "./database/repositories/settings.js";
import { UsersRepository } from "./database/repositories/users.js";
import { scheduleNightlyYtDlpUpdate, verifyRuntimeDependencies } from "./services/dependencies.js";
import { Downloader } from "./services/downloader.js";
import { MtprotoUploader } from "./services/mtprotoUploader.js";
import { killAllActiveProcesses } from "./services/process.js";
import { RateLimiter } from "./services/rateLimiter.js";
import { cleanupOrphanedTempDirs } from "./utils/files.js";

// Global uncaught exception handlers
process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled Rejection:", reason);
});

async function main(): Promise<void> {
  // 1. Startup cleanup of leftover temp directories from prior crashed runs / OOM
  await cleanupOrphanedTempDirs();

  await verifyRuntimeDependencies(config.autoUpdateYtDlp);
  scheduleNightlyYtDlpUpdate(config.autoUpdateYtDlp);
  const db = createDatabase(config.databasePath);
  const users = new UsersRepository(db);
  const downloads = new DownloadsRepository(db);
  const cache = new CacheRepository(db);
  const settings = new SettingsRepository(db);

  const mtprotoUploader = new MtprotoUploader(
    config.telegramApiId,
    config.telegramApiHash,
    config.botToken
  );

  const bot = createBot({
    token: config.botToken,
    adminIds: config.adminUserIds,
    users,
    downloads,
    cache,
    settings,
    downloader: new Downloader(
      config.downloadTimeoutMs,
      config.telegramFileLimitBytes,
      config.cookiesPath,
      config.maxDurationSeconds,
      config.diskSafetyMarginBytes,
      config.maxDiskBudgetMb
    ),
    rateLimiter: new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs),
    mtprotoUploader
  });

  await registerBotCommandsAndMenu(bot, config.adminUserIds);

  let server: http.Server | undefined;

  const shutdown = (signal: string) => {
    console.info(`[shutdown] Received ${signal}, killing active processes...`);
    killAllActiveProcesses();
    try {
      if (server) server.close();
    } catch {
      // Ignore server close error
    }
    try {
      bot.stop(signal);
    } catch {
      // Ignore if bot was running via webhook
    }
    try {
      db.close();
    } catch {
      // Ignore db close errors
    }
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const webhookDomain = process.env.WEBHOOK_DOMAIN;
  if (webhookDomain) {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.IP || "0.0.0.0";
    const webhookUrl = `https://${webhookDomain}/`;

    await bot.telegram.setWebhook(webhookUrl);
    console.info(`[startup] Webhook registered with Telegram: ${webhookUrl}`);

    const webhookMiddleware = bot.webhookCallback("/");
    server = http.createServer((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("✅ ربات تلگرام روشن و آماده است!");
        return;
      }
      webhookMiddleware(req, res);
    });

    server.listen(port, host, () => {
      console.info(`[startup] HTTP Server listening on ${host}:${port}`);
    });
  } else {
    await bot.launch();
    console.info("[startup] Telegram bot is running via polling");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error("[fatal] Bot failed to start:", message);
  process.exitCode = 1;
});
