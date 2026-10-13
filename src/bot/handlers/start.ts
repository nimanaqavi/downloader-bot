import type { Telegraf } from "telegraf";
import type { BotContext } from "../../types/index.js";

export function registerStartHandler(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    const text = [
      "<b>به ربات دانلود میمو خوش آمدید.</b>",
      "لینک مورد نظر را برای دریافت ارسال کنید.",
      "<code>https://www.youtube.com/watch?v=aqz-KE-bpKQ</code>"
    ].join("\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true }
    });
  });

  bot.help(async (ctx) => {
    const text = [
      "<b>راهنمای استفاده</b>",
      "<blockquote>▸ لینک مورد نظر از یوتیوب، اینستاگرام، تیک‌تاک و ... را ارسال کنید.</blockquote>",
      "<blockquote>▸ برای دریافت مستقیم صوت، عبارت <code>mp3</code> را قبل از لینک بنویسید.</blockquote>"
    ].join("\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true }
    });
  });
}
