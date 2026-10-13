import { Markup, type Telegraf } from "telegraf";
import type { BotContext } from "../../types/index.js";

export const mainReplyKeyboard = Markup.keyboard([
  [Markup.button.text("زبان 🌐"), Markup.button.text("بازخورد 📝")],
  [Markup.button.text("منو 📋"), Markup.button.text("راهنما ❓")]
]).resize();

export function registerStartHandler(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    await ctx.reply(
      "سلام! به ربات دانلود چندمنظوره میمو خوش آمدید. 📥🎬\n\n" +
        "لینک مورد نظر خود را از یوتیوب، اینستاگرام، تیک‌تاک، توییتر (X)، فیسبوک، ساندکلاد، ردیت یا هر وب‌سایت دیگری ارسال کنید تا با بالاترین سرعت دانلود شود.\n\n" +
        "💡 *نکته:* برای دانلود نسخه صوتی هر لینک، کافیست کلمه `mp3` را قبل از لینک بنویسید (مثال: `mp3 https://...`)",
      { parse_mode: "Markdown", ...mainReplyKeyboard }
    );
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      "راهنما ❓\n\n" +
        "• لینک مورد نظر خود از هر وب‌سایت یا پلتفرمی را اینجا بفرستید.\n" +
        "• برای ویدیوهای یوتیوب می‌توانید کیفیت دلخواه را انتخاب کنید.\n" +
        "• برای سایر سایت‌ها، ویدیو با بهترین کیفیت (تا 720p) خودکار دانلود می‌شود.\n" +
        "• برای دریافت مستقیم فایل صوتی (MP3)، عبارت mp3 را قبل از لینک ارسال کنید.\n" +
        "• سقف حجم فایل‌های قابل ارسال تا ۵۰۰ مگابایت (بسته به فضای سرور) می‌باشد.",
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
      "راهنمای استفاده:\nکافیست لینک ویدیو، پست، ریلز یا آهنگ مورد نظر خود را بفرستید تا ربات آن را دانلود و ارسال کند.",
      mainReplyKeyboard
    );
  });

  bot.action("btn_help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("لینک مدیا (یوتیوب، اینستاگرام، تیک‌تاک، توییتر، ساندکلاد و ...) را ارسال کنید.");
  });

  bot.action("btn_about", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      "ℹ️ *درباره ربات دانلودر میمو*\n\n" +
        "ابزار دانلود سریع انواع ویدیو، عکس و فایل‌های صوتی از شبکه‌های اجتماعی و سایت‌های اینترنتی.\n\n" +
        "⚡️ *پشتیبانی از:*\n" +
        "• یوتیوب (ویدیوها و شورتس با انتخاب کیفیت)\n" +
        "• اینستاگرام (پست، ریلز، استوری و آلبوم‌ها)\n" +
        "• تیک‌تاک، توییتر (X)، فیسبوک، ردیت و ساندکلاد\n" +
        "• دانلود صوت MP3 از تمامی سایت‌ها",
      { parse_mode: "Markdown" }
    );
  });

  bot.action("noop", async (ctx) => {
    await ctx.answerCbQuery("این بخش به‌زودی فعال می‌شود.");
  });
}
