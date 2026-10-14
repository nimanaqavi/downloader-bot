import type { Telegraf } from "telegraf";
import type { UsersRepository } from "../../database/repositories/users.js";
import { t, type Language } from "../../i18n/index.js";
import type { BotContext } from "../../types/index.js";

interface PendingLanguageLink {
  userId: number;
  url: string;
  statusMsgId?: number;
  timestamp: number;
}

export const pendingLanguageLinks = new Map<number, PendingLanguageLink>();

export function storePendingLanguageLink(userId: number, url: string, statusMsgId?: number): void {
  pendingLanguageLinks.set(userId, {
    userId,
    url,
    statusMsgId,
    timestamp: Date.now()
  });
}

function cleanupPendingLanguageLinks(): void {
  const now = Date.now();
  for (const [userId, item] of pendingLanguageLinks.entries()) {
    if (now - item.timestamp > 10 * 60 * 1000) {
      pendingLanguageLinks.delete(userId);
    }
  }
}

export function buildLanguageKeyboard(userLanguageCode?: string) {
  const isEnglishFirst = userLanguageCode && !userLanguageCode.toLowerCase().startsWith("fa");

  const buttons = isEnglishFirst
    ? [
        { text: t("en", "btn_en"), callback_data: "set_lang:en" },
        { text: t("fa", "btn_fa"), callback_data: "set_lang:fa" }
      ]
    : [
        { text: t("fa", "btn_fa"), callback_data: "set_lang:fa" },
        { text: t("en", "btn_en"), callback_data: "set_lang:en" }
      ];

  return {
    reply_markup: {
      inline_keyboard: [buttons]
    }
  };
}

export function registerStartHandler(
  bot: Telegraf<BotContext>,
  users: UsersRepository,
  onLanguageChosen?: (ctx: any, lang: Language, pendingLink?: string) => Promise<void>
): void {
  bot.start(async (ctx) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);

    // If language is already set, show welcoming start text in user language (no inline buttons)
    if (users.isLanguageSet(tgId)) {
      const lang = users.getLanguage(tgId);
      await ctx.reply(t(lang, "start"), {
        parse_mode: "HTML",
        reply_markup: { remove_keyboard: true }
      });
      return;
    }

    // New user without language selection: show choose language prompt
    cleanupPendingLanguageLinks();
    const keyboard = buildLanguageKeyboard(ctx.from.language_code);
    await ctx.reply(t("fa", "choose_language"), {
      parse_mode: "HTML",
      ...keyboard
    });
  });

  bot.help(async (ctx) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const lang = users.getLanguage(tgId);
    const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || "instagramdl_mahibot";

    await ctx.reply(t(lang, "help", botUsername), {
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true }
    });
  });

  bot.command("language", async (ctx) => {
    if (!ctx.from) return;
    const keyboard = buildLanguageKeyboard(ctx.from.language_code);

    await ctx.reply(t("fa", "choose_language"), {
      parse_mode: "HTML",
      ...keyboard
    });
  });

  bot.action(/^set_lang:(fa|en)$/, async (ctx) => {
    if (!ctx.from) return;
    const lang = ctx.match[1] as Language;
    const tgId = String(ctx.from.id);

    users.setLanguage(tgId, lang);

    await ctx.answerCbQuery(t(lang, "lang_changed"), { show_alert: true });

    // Edit that single message into the welcome text without inline buttons
    await ctx
      .editMessageText(t(lang, "start"), {
        parse_mode: "HTML"
      })
      .catch(() => undefined);

    // If user had a pending link before choosing language, continue processing it automatically
    const pending = pendingLanguageLinks.get(ctx.from.id);
    if (pending) {
      pendingLanguageLinks.delete(ctx.from.id);
      if (onLanguageChosen) {
        await onLanguageChosen(ctx, lang, pending.url);
      }
    }
  });
}
