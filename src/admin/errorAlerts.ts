import type { Telegraf } from "telegraf";
import type { BotContext } from "../types/index.js";
import { escapeHtml } from "../utils/formatting.js";

interface ErrorGroup {
  platform: string;
  category: string;
  lastErrorId: string;
  count: number;
  lastAlertTime: number;
}

class AdminErrorAlertsManager {
  private errors = new Map<string, ErrorGroup>();
  private readonly GROUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  async reportPlatformError(
    bot: Telegraf<BotContext>,
    adminIds: Set<string>,
    platform: string,
    errorId: string,
    rawError: unknown
  ): Promise<void> {
    const errText = rawError instanceof Error ? rawError.message : String(rawError);
    const category = this.categorizeError(errText);
    const key = `${platform}:${category}`;
    const now = Date.now();

    const existing = this.errors.get(key);

    if (existing) {
      existing.count++;
      existing.lastErrorId = errorId;

      if (now - existing.lastAlertTime >= this.GROUP_WINDOW_MS) {
        existing.lastAlertTime = now;
        await this.dispatchAlert(bot, adminIds, existing);
        existing.count = 0;
      }
    } else {
      const group: ErrorGroup = {
        platform,
        category,
        lastErrorId: errorId,
        count: 1,
        lastAlertTime: now
      };
      this.errors.set(key, group);
      await this.dispatchAlert(bot, adminIds, group);
    }
  }

  private categorizeError(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("login required") || lower.includes("checkpoint")) return "نیاز به ورود / لاگین پریده";
    if (lower.includes("sign in to confirm") || lower.includes("bot")) return "بلاک / محدودیت ضدبات سرور مبدأ";
    if (lower.includes("drm")) return "قفل DRM";
    if (lower.includes("403") || lower.includes("forbidden")) return "خطای دسترسی 403 Forbidden";
    if (lower.includes("timed out") || lower.includes("timeout")) return "تایم‌اوت ارتباط با سرور";
    return "خطای ارتباط یا استخراج";
  }

  private async dispatchAlert(
    bot: Telegraf<BotContext>,
    adminIds: Set<string>,
    group: ErrorGroup
  ): Promise<void> {
    const text = [
      `⚠️ <b>هشدار خطای پلتفرم [${escapeHtml(group.platform)}]</b>`,
      `دسته: <b>${escapeHtml(group.category)}</b>`,
      `شناسه آخرین خطا: <code>${group.lastErrorId}</code>`,
      group.count > 1 ? `تعداد تکرار در ۱۰ دقیقه اخیر: <code>${group.count}</code>` : ""
    ].filter(Boolean).join("\n");

    for (const adminId of adminIds) {
      const numericId = Number(adminId);
      if (!isNaN(numericId) && numericId > 0) {
        await bot.telegram.sendMessage(numericId, text, { parse_mode: "HTML" }).catch(() => undefined);
      }
    }
  }
}

export const adminErrorAlerts = new AdminErrorAlertsManager();
