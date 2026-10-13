import type { MiddlewareFn } from "telegraf";
import type { UsersRepository } from "../../database/repositories/users.js";
import type { BotContext } from "../../types/index.js";

export function registerUser(users: UsersRepository): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (ctx.from) {
      ctx.dbUser = users.upsert(String(ctx.from.id), ctx.from.username);
    }
    await next();
  };
}
