import { Markup, type Telegraf } from "telegraf";
import type { SettingsRepository } from "../../database/repositories/settings.js";
import type { BotContext } from "../../types/index.js";
import { escapeHtml } from "../../utils/formatting.js";

const PLATFORMS = [
  { key: "youtube", label: "YouTube ▶️" },
  { key: "instagram", label: "Instagram 📸" },
  { key: "tiktok", label: "TikTok 🎶" },
  { key: "spotify", label: "Spotify 🟢" },
  { key: "soundcloud", label: "SoundCloud ☁️" },
  { key: "x", label: "X (Twitter) ✖️" }
] as const;

export function registerStickerHandler(
  bot: Telegraf<BotContext>,
  adminIds: Set<string>,
  settings: SettingsRepository
): void {
  // Temporary admin-only tool: analyze sticker sent in private chat
  bot.on("sticker", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from || !adminIds.has(String(ctx.from.id))) {
      return next();
    }

    const sticker = ctx.message.sticker;
    if (!sticker) return next();

    const typeLabel =
      sticker.type === "custom_emoji"
        ? "ایموجی سفارشی (custom_emoji)"
        : sticker.type === "mask"
        ? "ماسک (mask)"
        : "معمولی (regular)";

    const animLabel = sticker.is_animated
      ? "انیمیشنی (TGS/Lottie)"
      : sticker.is_video
      ? "ویدیویی (WebM)"
      : "ثابت (Static)";

    const fileId = sticker.file_id;
    const fileUniqueId = sticker.file_unique_id;
    const setName = sticker.set_name || "بدون پک رسمی";
    const emoji = sticker.emoji || "ندارد";
    const customEmojiId = sticker.custom_emoji_id;

    // Cache fileId in temporary session storage using short index to fit in callback_data (max 64 bytes)
    const shortRef = fileUniqueId.slice(0, 16);
    settings.set(`stkr_ref:${shortRef}`, fileId);

    const text = [
      "🏷 <b>تحلیل استیکر ارسالی (مخصوص ادمین)</b>",
      "",
      `▫️ <b>نوع:</b> ${typeLabel}`,
      `▫️ <b>حالت:</b> ${animLabel}`,
      `▫️ <b>نام بسته:</b> <code>${escapeHtml(setName)}</code>`,
      `▫️ <b>ایموجی متناظر:</b> ${emoji}`,
      `▫️ <b>file_id:</b> <code>${escapeHtml(fileId)}</code>`,
      `▫️ <b>file_unique_id:</b> <code>${escapeHtml(fileUniqueId)}</code>`,
      customEmojiId ? `▫️ <b>custom_emoji_id:</b> <code>${escapeHtml(customEmojiId)}</code>` : "",
      "",
      "👇 انتخاب پلتفرم جهت انتساب و ارسال خودکار پیش از دانلود:"
    ]
      .filter(Boolean)
      .join("\n");

    const buttons = [
      [
        Markup.button.callback(PLATFORMS[0].label, `stkr:${PLATFORMS[0].key}:${shortRef}`),
        Markup.button.callback(PLATFORMS[1].label, `stkr:${PLATFORMS[1].key}:${shortRef}`)
      ],
      [
        Markup.button.callback(PLATFORMS[2].label, `stkr:${PLATFORMS[2].key}:${shortRef}`),
        Markup.button.callback(PLATFORMS[3].label, `stkr:${PLATFORMS[3].key}:${shortRef}`)
      ],
      [
        Markup.button.callback(PLATFORMS[4].label, `stkr:${PLATFORMS[4].key}:${shortRef}`),
        Markup.button.callback(PLATFORMS[5].label, `stkr:${PLATFORMS[5].key}:${shortRef}`)
      ]
    ];

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // Handle platform assignment callback
  bot.action(/^stkr:(youtube|instagram|tiktok|spotify|soundcloud|x):([a-zA-Z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !adminIds.has(String(ctx.from.id))) return;

    const platform = ctx.match[1]!;
    const shortRef = ctx.match[2]!;

    const fileId = settings.get(`stkr_ref:${shortRef}`, "");
    if (!fileId) {
      await ctx.editMessageText("❌ ارور: شناسه این استیکر منقضی شده است. لطفاً استیکر را مجدداً ارسال کنید.").catch(() => undefined);
      return;
    }

    settings.setPlatformSticker(platform, fileId);

    const platformName = PLATFORMS.find((p) => p.key === platform)?.label || platform;
    await ctx.editMessageText(
      `✅ <b>استیکر پلتفرم ذخیره شد!</b>\n\nاز این پس قبل از ارسال فایل‌های <b>${platformName}</b>، این استیکر ارسال خواهد شد.`,
      { parse_mode: "HTML" }
    ).catch(() => undefined);
  });
}
