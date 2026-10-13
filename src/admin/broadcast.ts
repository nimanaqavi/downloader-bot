import type { MiddlewareFn, Telegraf } from "telegraf";
import type { UsersRepository } from "../database/repositories/users.js";
import type { BotContext } from "../types/index.js";
import { adminMenu } from "./menus.js";

export class BroadcastManager {
  private readonly waiting = new Set<string>();

  constructor(
    private readonly bot: Telegraf<BotContext>,
    private readonly users: UsersRepository,
    private readonly adminIds: Set<string>
  ) {}

  begin(adminId: string): void {
    this.waiting.add(adminId);
  }

  cancel(adminId: string): void {
    this.waiting.delete(adminId);
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
        await ctx.reply("Broadcasts support text, photos, and videos. Send one of those or use /cancel.");
        return;
      }
      this.waiting.delete(adminId);
      const recipients = this.users.allTelegramIds();
      const progress = await ctx.reply(`Broadcast started: 0/${recipients.length}`);
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < recipients.length; index += 1) {
        try {
          await this.bot.telegram.copyMessage(recipients[index]!, ctx.chat!.id, ctx.message.message_id);
          sent += 1;
        } catch {
          failed += 1;
        }
        if ((index + 1) % 25 === 0) {
          await ctx.telegram
            .editMessageText(ctx.chat!.id, progress.message_id, undefined, `Broadcast progress: ${index + 1}/${recipients.length}`)
            .catch(() => undefined);
        }
      }
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        progress.message_id,
        undefined,
        `Broadcast complete. Sent to ${sent}/${recipients.length}; ${failed} failed (blocked or unavailable).`,
        adminMenu()
      );
    };
  }
}
