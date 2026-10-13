import { Markup, type Telegraf } from "telegraf";
import type { BotContext } from "../../types/index.js";

export function registerStartHandler(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    const text = [
      "<b>به ربات دانلود میمو خوش آمدید.</b>",
      "لینک مورد نظر را برای دریافت ارسال کنید.",
      "<code>https://www.youtube.com/watch?v=aqz-KE-bpKQ</code>"
    ].join("\n");

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("🇮🇷 فارسی", "lang:fa"),
        Markup.button.callback("🇬🇧 English", "lang:en")
      ]
    ]);

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: {
        ...keyboard.reply_markup,
        remove_keyboard: true
      }
    });
  });

  bot.action("lang:fa", async (ctx) => {
    await ctx.answerCbQuery("زبان روی فارسی تنظیم شد ✓");
    await ctx.editMessageText(
      [
        "<b>زبان فعال: فارسی 🇮🇷</b>",
        "لینک مورد نظر را برای دریافت ارسال کنید.",
        "<code>https://www.youtube.com/watch?v=aqz-KE-bpKQ</code>"
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✓ فارسی", "lang:fa"),
            Markup.button.callback("English", "lang:en")
          ]
        ])
      }
    ).catch(() => undefined);
  });

  bot.action("lang:en", async (ctx) => {
    await ctx.answerCbQuery("Language set to English ✓");
    await ctx.editMessageText(
      [
        "<b>Active Language: English 🇬🇧</b>",
        "Send any media link to download.",
        "<code>https://www.youtube.com/watch?v=aqz-KE-bpKQ</code>"
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("فارسی", "lang:fa"),
            Markup.button.callback("✓ English", "lang:en")
          ]
        ])
      }
    ).catch(() => undefined);
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
