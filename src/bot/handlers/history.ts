import { Markup, type Telegraf } from "telegraf";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { UsersRepository } from "../../database/repositories/users.js";
import { t, type Language } from "../../i18n/index.js";
import type { BotContext } from "../../types/index.js";
import { escapeHtml, truncateText } from "../../utils/formatting.js";

function getHistoryKeyboard(lang: Language) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, "hist_btn_instagram"), "hist:instagram"),
      Markup.button.callback(t(lang, "hist_btn_youtube"), "hist:youtube")
    ],
    [
      Markup.button.callback(t(lang, "hist_btn_tiktok"), "hist:tiktok"),
      Markup.button.callback(t(lang, "hist_btn_all"), "hist:all")
    ]
  ]);
}

export function registerHistoryHandler(
  bot: Telegraf<BotContext>,
  downloads: DownloadsRepository,
  users: UsersRepository
): void {
  bot.command("history", async (ctx) => {
    if (!ctx.dbUser || !ctx.from) return;
    const lang = users.getLanguage(String(ctx.from.id));

    await ctx.reply(t(lang, "history_title"), {
      parse_mode: "HTML",
      ...getHistoryKeyboard(lang)
    });
  });

  bot.action(/^hist:(instagram|youtube|tiktok|all)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.dbUser || !ctx.from) return;

    const lang = users.getLanguage(String(ctx.from.id));
    const platform = ctx.match[1]!;
    const platformLabel =
      platform === "instagram"
        ? (lang === "en" ? "Instagram" : "اینستاگرام")
        : platform === "youtube"
        ? (lang === "en" ? "YouTube" : "یوتیوب")
        : platform === "tiktok"
        ? (lang === "en" ? "TikTok" : "تیک‌تاک")
        : (lang === "en" ? "All Platforms" : "همه پلتفرم‌ها");

    const rows = downloads.listForUserByPlatform(ctx.dbUser.id, platform, 5);

    if (rows.length === 0) {
      await ctx
        .editMessageText(t(lang, "history_empty", platformLabel), {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_back"), "hist:menu")]])
        })
        .catch(() => undefined);
      return;
    }

    const items = rows.map((r, i) => {
      const dateStr = r.createdAt.replace("T", " ").replace(/\.\d+Z$/, "").slice(0, 16);
      const shortUrl = truncateText(r.url, 45);
      return `${i + 1}. <b>${dateStr}</b>\n<code>${escapeHtml(shortUrl)}</code>`;
    });

    const text = [
      t(lang, "history_recent", platformLabel),
      items.join("\n\n")
    ].join("\n\n");

    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_back"), "hist:menu")]])
      })
      .catch(() => undefined);
  });

  bot.action("hist:menu", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const lang = users.getLanguage(String(ctx.from.id));

    await ctx
      .editMessageText(t(lang, "history_title"), {
        parse_mode: "HTML",
        ...getHistoryKeyboard(lang)
      })
      .catch(() => undefined);
  });
}
