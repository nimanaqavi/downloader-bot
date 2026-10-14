import type { Telegraf } from "telegraf";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { SettingsRepository } from "../../database/repositories/settings.js";
import type { UsersRepository } from "../../database/repositories/users.js";
import { t, type Language } from "../../i18n/index.js";
import type { BotContext, DownloadRecord } from "../../types/index.js";
import { escapeHtml } from "../../utils/formatting.js";

function getHistoryKeyboard(lang: Language) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: t(lang, "hist_btn_instagram"), callback_data: "hist:instagram" },
          { text: t(lang, "hist_btn_youtube"), callback_data: "hist:youtube" }
        ],
        [
          { text: t(lang, "hist_btn_tiktok"), callback_data: "hist:tiktok" },
          { text: t(lang, "hist_btn_all"), callback_data: "hist:all" }
        ]
      ]
    }
  };
}

export function formatHistoryMessages(
  platformLabel: string,
  platformEmojiHtml: string,
  rows: DownloadRecord[],
  lang: Language,
  maxMessageLength: number = 4096
): string[] {
  const header = `${t(lang, "history_recent", `${platformEmojiHtml} ${platformLabel}`)}\n\n`;

  const itemBlocks = rows.map((r, i) => {
    const dateStr = r.createdAt.replace("T", " ").replace(/\.\d+Z$/, "").slice(0, 16);
    // Link displayed in full without truncation, properly HTML escaped
    return `${i + 1}. <b>${dateStr}</b>\n<code>${escapeHtml(r.url)}</code>`;
  });

  const messages: string[] = [];
  let currentMsg = header;

  for (let i = 0; i < itemBlocks.length; i++) {
    const block = itemBlocks[i]!;
    const separator = currentMsg === header ? "" : "\n\n";

    if ((currentMsg + separator + block).length > maxMessageLength) {
      if (currentMsg.trim().length > 0) {
        messages.push(currentMsg.trim());
      }
      currentMsg = block;
    } else {
      currentMsg += separator + block;
    }
  }

  if (currentMsg.trim().length > 0) {
    messages.push(currentMsg.trim());
  }

  return messages.length > 0 ? messages : [header.trim()];
}

export function registerHistoryHandler(
  bot: Telegraf<BotContext>,
  downloads: DownloadsRepository,
  users: UsersRepository,
  settings: SettingsRepository
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

    const platformEmojiHtml = settings.getPlatformEmojiHtml(platform);
    const rows = downloads.listForUserByPlatform(ctx.dbUser.id, platform, 5);

    const backBtnMarkup = {
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, "btn_back"), callback_data: "hist:menu" }]]
      }
    };

    if (rows.length === 0) {
      await ctx
        .editMessageText(t(lang, "history_empty", `${platformEmojiHtml} ${platformLabel}`), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...backBtnMarkup
        })
        .catch(() => undefined);
      return;
    }

    const messages = formatHistoryMessages(platformLabel, platformEmojiHtml, rows, lang, 4096);

    if (messages.length === 1) {
      await ctx
        .editMessageText(messages[0]!, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...backBtnMarkup
        })
        .catch(() => undefined);
    } else {
      await ctx
        .editMessageText(messages[0]!, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true }
        })
        .catch(() => undefined);

      for (let idx = 1; idx < messages.length; idx++) {
        const isLast = idx === messages.length - 1;
        await ctx.reply(messages[idx]!, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...(isLast ? backBtnMarkup : {})
        });
      }
    }
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
