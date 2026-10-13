import { Markup, type Telegraf } from "telegraf";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { BotContext } from "../../types/index.js";
import { escapeHtml, truncateText } from "../../utils/formatting.js";

const platformButtons = Markup.inlineKeyboard([
  [
    Markup.button.callback("📸 اینستاگرام", "hist:instagram"),
    Markup.button.callback("▶️ یوتیوب", "hist:youtube")
  ],
  [
    Markup.button.callback("🎵 تیک‌تاک", "hist:tiktok"),
    Markup.button.callback("🌐 همه دانلودها", "hist:all")
  ]
]);

export function registerHistoryHandler(
  bot: Telegraf<BotContext>,
  downloads: DownloadsRepository
): void {
  bot.command("history", async (ctx) => {
    if (!ctx.dbUser) return;
    const text = [
      "<b>📜 تاریخچه دانلودهای شما</b>",
      "پلتفرم مورد نظر را برای مشاهده ۵ دانلود اخیر انتخاب کنید:"
    ].join("\n\n");

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...platformButtons
    });
  });

  bot.action(/^hist:(instagram|youtube|tiktok|all)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.dbUser) return;

    const platform = ctx.match[1]!;
    const platformLabel =
      platform === "instagram"
        ? "اینستاگرام"
        : platform === "youtube"
        ? "یوتیوب"
        : platform === "tiktok"
        ? "تیک‌تاک"
        : "همه پلتفرم‌ها";

    const rows = downloads.listForUserByPlatform(ctx.dbUser.id, platform, 5);

    if (rows.length === 0) {
      const emptyText = [
        `<b>📜 تاریخچه (${platformLabel})</b>`,
        "هنوز دانلودی در این بخش ثبت نشده است."
      ].join("\n\n");

      await ctx.editMessageText(emptyText, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 بازگشت", "hist:menu")]])
      }).catch(() => undefined);
      return;
    }

    const items = rows.map((r, i) => {
      const dateStr = r.createdAt.replace("T", " ").replace(/\.\d+Z$/, "").slice(0, 16);
      const shortUrl = truncateText(r.url, 45);
      return `${i + 1}. <b>${dateStr}</b>\n<code>${escapeHtml(shortUrl)}</code>`;
    });

    const text = [
      `<b>📜 ۵ دانلود اخیر (${platformLabel}):</b>`,
      items.join("\n\n")
    ].join("\n\n");

    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔙 بازگشت", "hist:menu")]])
    }).catch(() => undefined);
  });

  bot.action("hist:menu", async (ctx) => {
    await ctx.answerCbQuery();
    const text = [
      "<b>📜 تاریخچه دانلودهای شما</b>",
      "پلتفرم مورد نظر را برای مشاهده ۵ دانلود اخیر انتخاب کنید:"
    ].join("\n\n");

    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...platformButtons
    }).catch(() => undefined);
  });
}
