import { Markup, type Telegraf } from "telegraf";
import type { BotContext } from "../../types/index.js";

export const mainReplyKeyboard = Markup.keyboard([
  [Markup.button.text("زبان 🌐"), Markup.button.text("بازخورد 📝")],
  [Markup.button.text("منو 📋"), Markup.button.text("راهنما ❓")]
]).resize();

export function registerStartHandler(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    await ctx.reply(
      "سلام! به ربات دانلود از اینستاگرام و یوتیوب خوش آمدید. 🎬\n\n" +
        "لینک مورد نظر خود (پست، ریلز، استوری اینستاگرام یا ویدیو/شورتس یوتیوب) را ارسال کنید.",
      mainReplyKeyboard
    );
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      "راهنما ❓\n\n" +
        "• یک لینک معتبر از اینستاگرام یا یوتیوب ارسال کنید.\n" +
        "• حداکثر حجم قابل دانلود ۵۰۰ مگابایت می‌باشد.\n" +
        "• محدودیت ۳ درخواست در دقیقه برقرار است.",
      mainReplyKeyboard
    );
  });

  bot.hears("زبان 🌐", async (ctx) => {
    await ctx.reply(
      "زبان فعلی: فارسی 🇮🇷\nتغییر زبان به‌زودی اضافه می‌شود.",
      Markup.inlineKeyboard([[Markup.button.callback("تغییر زبان (بزودی)", "noop")]])
    );
  });

  bot.hears("بازخورد 📝", async (ctx) => {
    await ctx.reply(
      "برای ارسال بازخورد، نظر خود را بنویسید یا با پشتیبانی در ارتباط باشید.",
      Markup.inlineKeyboard([[Markup.button.url("ارتباط با پشتیبانی 💬", "https://t.me/telegram")]])
    );
  });

  bot.hears("منو 📋", async (ctx) => {
    await ctx.reply(
      "منوی اصلی ربات:",
      Markup.inlineKeyboard([
        [Markup.button.callback("راهنما ❓", "btn_help"), Markup.button.callback("درباره ربات ℹ️", "btn_about")]
      ])
    );
  });

  bot.hears("راهنما ❓", async (ctx) => {
    await ctx.reply(
      "راهنمای استفاده:\nفقط کافیست لینک پست، ریلز یا شورتس مورد نظر را اینجا بفرستید.",
      mainReplyKeyboard
    );
  });

  bot.action("btn_help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("لینک پست/ریلز اینستاگرام یا یوتیوب خود را بفرستید تا ویدیو دانلود و ارسال شود.");
  });

  bot.action("btn_about", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      "ℹ️ *درباره ربات*\n\n" +
        "این ربات یک ابزار رایگان برای دانلود آسان ویدیوها و تصاویر از شبکه های اجتماعی اینستاگرام و یوتیوب می‌باشد.\n\n" +
        "⚡️ *ویژگی‌ها:*\n" +
        "• پشتیبانی از پست، ریلز و استوری اینستاگرام\n" +
        "• پشتیبانی از ویدیوها و شورتس یوتیوب\n" +
        "• سرعت بالا و حفظ کیفیت اصلی\n" +
        "• حداکثر حجم فایل: ۵۰۰ مگابایت",
      { parse_mode: "Markdown" }
    );
  });

  bot.action("noop", async (ctx) => {
    await ctx.answerCbQuery("این بخش به‌زودی فعال می‌شود.");
  });
}
