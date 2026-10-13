import type { MiddlewareFn } from "telegraf";
import type { BotContext } from "../../types/index.js";

export function requireNotBanned(adminIds: Set<string>): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (ctx.dbUser?.isBanned && !adminIds.has(ctx.dbUser.telegramId)) {
      await ctx.reply("You are banned from using this bot.");
      return;
    }
    await next();
  };
}
