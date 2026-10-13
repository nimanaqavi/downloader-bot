import { Markup, type Telegraf } from "telegraf";
import type { UsersRepository } from "../../database/repositories/users.js";
import type { BotContext } from "../../types/index.js";

const languageKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback("🇮🇷 فارسی", "set_lang:fa"),
    Markup.button.callback("🇬🇧 English", "set_lang:en")
  ]
]);

export function registerStartHandler(
  bot: Telegraf<BotContext>,
  users: UsersRepository
): void {
  bot.start(async (ctx) => {
    const text = [
      "<b>دانلودر حلال 🥷✨</b>",
      "",
      "<blockquote><b>هر لینکی می‌خوای بده، تو تلگرام آنی تحویل بگیر!</b> ⚡️",
      "",
      "فرقی نداره ریلز باشه، یوتیوب باشه یا موزیک؛ فقط کافیه لینکش رو بفرستی تا درجا برات بفرستمش 📥",
      "",
      "▫️ <i>Instagram</i> • <i>YouTube</i> • <i>TikTok</i> • <i>SoundCloud</i></blockquote>"
    ].join("\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true }
    });
  });

  bot.command("language", async (ctx) => {
    const text = [
      "<b>🌐 انتخاب زبان / Select Language</b>",
      "لطفاً زبان مورد نظر خود را انتخاب کنید:"
    ].join("\n\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...languageKeyboard
    });
  });

  bot.action(/^set_lang:(fa|en)$/, async (ctx) => {
    const lang = ctx.match[1]!;
    if (ctx.from) {
      users.setLanguage(String(ctx.from.id), lang);
    }
    const alertText = lang === "fa" ? "زبان با موفقیت تغییر کرد ✓" : "Language updated successfully ✓";
    await ctx.answerCbQuery(alertText, { show_alert: true });

    const updatedText =
      lang === "fa"
        ? "<b>زبان فعال: فارسی 🇮🇷</b>\nلینک ویدیوی خود را ارسال کنید."
        : "<b>Active Language: English 🇬🇧</b>\nSend any video or audio link.";

    await ctx.editMessageText(updatedText, {
      parse_mode: "HTML",
      ...languageKeyboard
    }).catch(() => undefined);
  });
}
