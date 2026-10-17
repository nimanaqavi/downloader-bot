import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";

const booleanString = z
  .string()
  .default("true")
  .transform((value) => value.toLowerCase() === "true");

const schema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  ADMIN_USER_IDS: z.string().min(1, "ADMIN_USER_IDS is required"),
  DATABASE_PATH: z.string().default("./data/bot.db"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  TELEGRAM_FILE_LIMIT_MB: z.coerce.number().positive().max(2000).default(500),
  TELEGRAM_API_ID: z.coerce.number().int().default(2040),
  TELEGRAM_API_HASH: z.string().default("b18441a1ff607e10a989891a5462e627"),
  DOWNLOAD_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  AUTO_UPDATE_YTDLP: booleanString,
  COOKIES_PATH: z.string().optional(),
  INSTAGRAM_COOKIES_PATH: z.string().optional(),
  MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(10800),
  DISK_SAFETY_MARGIN_MB: z.coerce.number().int().positive().default(100),
  MAX_DISK_BUDGET_MB: z.coerce.number().int().positive().default(1000),
  STORAGE_CHANNEL_ID: z.string().optional(),
  BOT_USERNAME: z.string().default("instagramdl_mahibot"),
  TIKTOK_PROVIDER: z.enum(["tikwm_first", "ytdlp_first", "ytdlp_only"]).default("tikwm_first")
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
  cookiesPath: parsed.data.COOKIES_PATH
    ? resolve(parsed.data.COOKIES_PATH)
    : parsed.data.INSTAGRAM_COOKIES_PATH
    ? resolve(parsed.data.INSTAGRAM_COOKIES_PATH)
    : undefined,
  instagramCookiesPath: parsed.data.INSTAGRAM_COOKIES_PATH
    ? resolve(parsed.data.INSTAGRAM_COOKIES_PATH)
    : parsed.data.COOKIES_PATH
    ? resolve(parsed.data.COOKIES_PATH)
    : undefined,
  maxDurationSeconds: parsed.data.MAX_DURATION_SECONDS,
  diskSafetyMarginBytes: parsed.data.DISK_SAFETY_MARGIN_MB * 1024 * 1024,
  maxDiskBudgetMb: parsed.data.MAX_DISK_BUDGET_MB,
  storageChannelId: parsed.data.STORAGE_CHANNEL_ID ? parsed.data.STORAGE_CHANNEL_ID.trim() : undefined,
  botUsername: parsed.data.BOT_USERNAME.replace(/^@/, ""),
  tiktokProvider: parsed.data.TIKTOK_PROVIDER
};
