import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";

const booleanString = z
  .string()
  .default("false")
  .transform((value) => value.toLowerCase() === "true");

const schema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  ADMIN_USER_IDS: z.string().min(1, "ADMIN_USER_IDS is required"),
  DATABASE_PATH: z.string().default("./data/bot.db"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  TELEGRAM_FILE_LIMIT_MB: z.coerce.number().positive().max(2000).default(500),
  TELEGRAM_API_ID: z.coerce.number().int().default(2040),
  TELEGRAM_API_HASH: z.string().default("00000000000000000000000000000000"),
  DOWNLOAD_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  AUTO_UPDATE_YTDLP: booleanString,
  INSTAGRAM_COOKIES_PATH: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => issue.message).join(", ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

const adminIds = parsed.data.ADMIN_USER_IDS.split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (adminIds.some((id) => !/^\d+$/.test(id))) {
  throw new Error("ADMIN_USER_IDS must be a comma-separated list of numeric Telegram user IDs");
}

export const config = {
  botToken: parsed.data.BOT_TOKEN,
  adminUserIds: new Set(adminIds),
  databasePath: resolve(parsed.data.DATABASE_PATH),
  rateLimitMax: parsed.data.RATE_LIMIT_MAX,
  rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_SECONDS * 1000,
  telegramFileLimitBytes: Math.floor(parsed.data.TELEGRAM_FILE_LIMIT_MB * 1024 * 1024),
  telegramApiId: parsed.data.TELEGRAM_API_ID,
  telegramApiHash: parsed.data.TELEGRAM_API_HASH,
  downloadTimeoutMs: parsed.data.DOWNLOAD_TIMEOUT_SECONDS * 1000,
  autoUpdateYtDlp: parsed.data.AUTO_UPDATE_YTDLP,
  instagramCookiesPath: parsed.data.INSTAGRAM_COOKIES_PATH
    ? resolve(parsed.data.INSTAGRAM_COOKIES_PATH)
    : undefined
};
