import crypto from "node:crypto";
import { t, type Language } from "../i18n/index.js";

export function generateErrorId(): string {
  return "ERR-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

export function sanitizeLog(text: unknown, tokenToMask?: string): string {
  if (!text) return "";
  let str = typeof text === "string" ? text : text instanceof Error ? text.stack || text.message : String(text);

  // Mask Telegram bot tokens: e.g. 123456789:ABCdef-ghIJK_...
  str = str.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED_TOKEN]");
  str = str.replace(/\d{8,11}:[A-Za-z0-9_-]{30,50}/g, "[REDACTED_TOKEN]");

  if (tokenToMask) {
    str = str.split(tokenToMask).join("[REDACTED_TOKEN]");
  }

  return str;
}

export function friendlyDownloadError(
  error: unknown,
  errorId?: string,
  lang: Language = "fa"
): string {
  const errId = errorId || generateErrorId();
  const selectedLang = lang === "en" ? "en" : "fa";

  if (error instanceof Error) {
    const msg = error.message;
    const lower = msg.toLowerCase();

    if (msg.includes("سقف") || msg.includes("بیشتر از سقف") || msg.includes("فضای خالی")) {
      return `${msg}\n<code>${selectedLang === "en" ? "Error ID" : "کد پیگیری"}: ${errId}</code>`;
    }
    if (lower.includes("max-filesize") || lower.includes("file is larger")) {
      return t(selectedLang, "err_max_size", errId);
    }
    if (lower.includes("too large") || lower.includes("413")) {
      return selectedLang === "en"
        ? `⚠️ This video exceeds Telegram's 50MB Bot limit. To upload files up to 2GB, please configure TELEGRAM_API_ID & TELEGRAM_API_HASH on the server, or download 360p instead.\n<code>Error ID: ${errId}</code>`
        : `⚠️ حجم این ویدیو بیش از ۵۰ مگابایت است. ارسال فایل‌های بالای ۵۰ مگابایت (تا ۲ گیگابایت) در تلگرام نیازمند تنظیم TELEGRAM_API_ID و TELEGRAM_API_HASH در سرور است. لطفاً کیفیت 360p را انتخاب فرمایید.\n<code>کد پیگیری: ${errId}</code>`;
    }
    if (
      lower.includes("duration") ||
      lower.includes("longer than") ||
      lower.includes("does not pass filter")
    ) {
      return t(selectedLang, "err_max_duration", errId);
    }
    if (lower.includes("spotify") || lower.includes("drm")) {
      return t(selectedLang, "err_spotify_drm");
    }
    if (
      lower.includes("login required") ||
      lower.includes("checkpoint") ||
      lower.includes("instagram")
    ) {
      return t(selectedLang, "err_instagram_private", errId);
    }
    if (lower.includes("sign in") || lower.includes("bot")) {
      return t(selectedLang, "err_source_blocked", errId);
    }
    if (lower.includes("timeout") || lower.includes("timed out")) {
      return t(selectedLang, "err_timeout", errId);
    }
    if (lower.includes("private") || lower.includes("members-only")) {
      return t(selectedLang, "err_private_media", errId);
    }
    if (lower.includes("tiktok")) {
      return t(selectedLang, "err_tiktok", errId);
    }
    if (lower.includes("یک دانلود در حال پردازش")) {
      return t(selectedLang, "err_active_job");
    }
  }

  return t(selectedLang, "err_generic", errId);
}
