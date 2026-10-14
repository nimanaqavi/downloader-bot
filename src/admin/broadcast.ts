import { Markup, type MiddlewareFn, type Telegraf } from "telegraf";
import type { UsersRepository } from "../database/repositories/users.js";
import type { BotContext } from "../types/index.js";
import { adminMenu } from "./menus.js";

export class BroadcastManager {
  private readonly waiting = new Set<string>();
  private targetLanguage: "all" | "fa" | "en" = "all";
  private isBroadcasting = false;
  private cancelRequested = false;

  constructor(
    private readonly bot: Telegraf<BotContext>,
    private readonly users: UsersRepository,
    private readonly adminIds: Set<string>
  ) {}

  begin(adminId: string, langFilter: "all" | "fa" | "en" = "all"): void {
    if (this.isBroadcasting) {
      throw new Error("یک ارسال همگانی در حال اجراست. لطفاً تا پایان آن صبر کنید.");
    }
    this.targetLanguage = langFilter;
    this.waiting.add(adminId);
  }

  cancel(adminId: string): void {
    this.waiting.delete(adminId);
  }

  requestCancel(): void {
    if (this.isBroadcasting) {
      this.cancelRequested = true;
    }
  }

  middleware(): MiddlewareFn<BotContext> {
    return async (ctx, next) => {
      const adminId = ctx.from ? String(ctx.from.id) : "";
      if (!this.adminIds.has(adminId) || !this.waiting.has(adminId) || !ctx.message) {
        await next();
        return;
      }
      if ("text" in ctx.message && ctx.message.text.startsWith("/")) {
        await next();
        return;
      }
      if (!("text" in ctx.message || "photo" in ctx.message || "video" in ctx.message)) {
        await ctx.reply("ارسال همگانی از متن، عکس و ویدیو پشتیبانی می‌کند. برای انصراف /cancel بزنید.");
        return;
      }

      this.waiting.delete(adminId);
      this.isBroadcasting = true;
      this.cancelRequested = false;

      const langLabel =
        this.targetLanguage === "fa"
          ? "فقط کاربران فارسی"
          : this.targetLanguage === "en"
          ? "فقط کاربران انگلیسی"
          : "همه کاربران";

      const totalUsers = this.users.count();
      const statusMsg = await ctx.reply(
        `▸ در حال آماده‌سازی ارسال همگانی به <b>${langLabel}</b>...`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("✕ لغو ارسال همگانی", "adm:cancel_bc")]])
        }
      );

      let sent = 0;
      let blocked = 0;
      let failed = 0;
      let processed = 0;
      const BATCH_SIZE = 100;
      let offset = 0;

      try {
        while (offset < totalUsers) {
          if (this.cancelRequested) {
            await ctx.reply("ارسال همگانی توسط ادمین متوقف شد.", adminMenu());
            break;
          }

          const batch = this.users.listBatchActive(offset, BATCH_SIZE, this.targetLanguage);
          if (batch.length === 0) break;

          for (const user of batch) {
            if (this.cancelRequested) break;

            try {
              await this.bot.telegram.copyMessage(user.telegramId, ctx.chat!.id, ctx.message.message_id);
              sent++;
            } catch (err: any) {
              const errStr = String(err?.message || err);
              // User blocked bot (403 Forbidden)
              if (err?.response?.error_code === 403 || errStr.includes("bot was blocked")) {
                this.users.setBlockedByTelegramId(user.telegramId, true);
                blocked++;
              } else if (err?.response?.error_code === 429) {
                // Telegram FloodWait
                const waitSec = err?.response?.parameters?.retry_after || 5;
                await new Promise((r) => setTimeout(r, waitSec * 1000 + 500));
                // Retry once
                try {
                  await this.bot.telegram.copyMessage(user.telegramId, ctx.chat!.id, ctx.message.message_id);
                  sent++;
                } catch {
                  failed++;
                }
              } else {
                failed++;
              }
            }
            processed++;

            // Throttled progress report every 25 users
            if (processed % 25 === 0) {
              await ctx.telegram
                .editMessageText(
                  ctx.chat!.id,
                  statusMsg.message_id,
                  undefined,
                  `▸ پیشرفت ارسال (${langLabel}): <code>${processed}</code> پردازش شد\n✓ موفق: <code>${sent}</code> │ ✕ ناموفق/بلاک: <code>${blocked + failed}</code>`,
                  {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback("✕ لغو ارسال همگانی", "adm:cancel_bc")]])
                  }
                )
                .catch(() => undefined);
            }
          }

          offset += BATCH_SIZE;
        }

        const report = [
          "<b>✓ ارسال همگانی به پایان رسید</b>",
          `<blockquote>▸ جامعه هدف: <b>${langLabel}</b>`,
          `▸ دریافت موفق: <code>${sent}</code>`,
          `▸ کاربرانی که بلاک کرده‌اند: <code>${blocked}</code>`,
          `▸ ناموفق / اکانت حذف‌شده: <code>${failed}</code>`,
          `▸ کل پردازش‌شده: <code>${processed}</code></blockquote>`
        ].join("\n");

        await ctx.telegram
          .editMessageText(ctx.chat!.id, statusMsg.message_id, undefined, report, {
            parse_mode: "HTML",
            ...adminMenu()
          })
          .catch(() => ctx.reply(report, { parse_mode: "HTML", ...adminMenu() }));
      } finally {
        this.isBroadcasting = false;
        this.cancelRequested = false;
      }
    };
  }
}
