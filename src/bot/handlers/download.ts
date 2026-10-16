import crypto from "node:crypto";
import { Input, Markup, type Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { adminErrorAlerts } from "../../admin/errorAlerts.js";
import { config } from "../../config.js";
import type { CacheRepository } from "../../database/repositories/cache.js";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { SettingsRepository } from "../../database/repositories/settings.js";
import type { UsersRepository } from "../../database/repositories/users.js";
import { t, type Language } from "../../i18n/index.js";
import type { DownloadQueue } from "../../services/downloadQueue.js";
import type { Downloader, VideoQuality } from "../../services/downloader.js";
import type { ForceJoinService } from "../../services/forceJoin.js";
import { metricsManager } from "../../services/metrics.js";
import type { MtprotoUploader } from "../../services/mtprotoUploader.js";
import type { RateLimiter } from "../../services/rateLimiter.js";
import { resolveSpotifyTrack, SpotifyError } from "../../services/spotify.js";
import { downloadTikTokViaTikWm } from "../../services/tiktok.js";
import type { BotContext, DownloadResult } from "../../types/index.js";
import { removeDirectory } from "../../utils/files.js";
import {
  buildFinalCaption,
  buildQualityCardText,
  escapeHtml,
  formatBytes,
  formatDuration,
  renderProgressBar,
  truncateText
} from "../../utils/formatting.js";
import { parseMediaUrl, type ParsedMediaUrl } from "../../utils/mediaUrl.js";
import { validateSafeUrl } from "../../utils/ssrf.js";
import { friendlyDownloadError, generateErrorId } from "../../utils/telegramErrors.js";
import { safeEditMessageText } from "../../utils/throttler.js";
import { normalizeMediaUrl } from "../../utils/urlNormalizer.js";
import { buildLanguageKeyboard, storePendingLanguageLink } from "./start.js";

interface PendingSelection {
  userId: number;
  url: string;
  urlNormalized: string;
  platformName: string;
  platform: string;
  title: string;
  author?: string;
  duration?: number;
  filesizeApprox?: number;
  statusMsgId: number;
  isPhotoCard?: boolean;
  timestamp: number;
  lang: Language;
}

const pendingSelections = new Map<string, PendingSelection>();

function cleanupPending(): void {
  const now = Date.now();
  for (const [token, item] of pendingSelections.entries()) {
    if (now - item.timestamp > 10 * 60 * 1000) {
      pendingSelections.delete(token);
    }
  }
}

export function registerDownloadHandler(
  bot: Telegraf<BotContext>,
  downloads: DownloadsRepository,
  downloader: Downloader,
  rateLimiter: RateLimiter,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository,
  forceJoin: ForceJoinService,
  adminIds: Set<string>,
  users: UsersRepository,
  settings: SettingsRepository
): (ctx: any, lang: Language, url: string) => Promise<void> {
  const handleLinkInput = async (ctx: any, rawUrl: string) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);

    // 0. Language check: if user hasn't set language, save link and show language selector
    if (!users.isLanguageSet(tgId)) {
      storePendingLanguageLink(ctx.from.id, rawUrl);
      const keyboard = buildLanguageKeyboard(ctx.from?.language_code);
      await ctx.reply(t("fa", "choose_language"), {
        parse_mode: "HTML",
        ...keyboard
      });
      return;
    }

    const userLang = users.getLanguage(tgId);

    // 1. Force Join Check
    const fjCheck = await forceJoin.checkMembership(bot, ctx.from.id, adminIds, rawUrl);
    if (!fjCheck.isAllowed && fjCheck.joinPrompt) {
      await ctx.reply(fjCheck.joinPrompt.text, {
        parse_mode: "HTML",
        ...fjCheck.joinPrompt.keyboard
      });
      return;
    }

    // 2. Parse and validate media URL
    const media = await parseMediaUrl(rawUrl);
    if (!media) {
      await ctx.reply(t(userLang, "err_invalid_url"), { parse_mode: "HTML" });
      return;
    }

    // 3. Rate limiter
    const rate = rateLimiter.consume(tgId);
    if (!rate.allowed) {
      await ctx.reply(t(userLang, "err_rate_limit", rate.retryAfterSeconds), { parse_mode: "HTML" });
      return;
    }

    const urlNormalized = normalizeMediaUrl(media.url);

    // 4. Handle Spotify
    if (media.platform === "spotify") {
      await handleSpotify(ctx, bot, adminIds, media, urlNormalized, downloads, downloader, downloadQueue, mtprotoUploader, cache, userLang, settings);
      return;
    }

    // 5. Direct audio request via "mp3 <url>"
    if (media.isAudioRequested) {
      await handleDirectAudio(ctx, bot, adminIds, media, urlNormalized, downloads, downloader, downloadQueue, mtprotoUploader, cache, userLang, settings);
      return;
    }

    // 6. Initial checking message
    const statusMsg = await ctx.reply(t(userLang, "checking_link"), { parse_mode: "HTML" });

    // 7. Handle TikTok
    if (media.platform === "tiktok") {
      await handleTikTok(
        ctx,
        bot,
        adminIds,
        media,
        urlNormalized,
        statusMsg.message_id,
        downloads,
        downloader,
        downloadQueue,
        mtprotoUploader,
        cache,
        userLang,
        settings
      );
      return;
    }

    // 8. Handle Instagram
    if (media.platform === "instagram") {
      await handleInstagramRequest(
        ctx,
        bot,
        adminIds,
        media,
        urlNormalized,
        statusMsg.message_id,
        downloads,
        downloader,
        downloadQueue,
        mtprotoUploader,
        cache,
        userLang,
        settings
      );
      return;
    }

    // 9. YouTube & Generic Platforms
    cleanupPending();
    const meta = await downloader.fetchMetadata(media.url);
    const token = crypto.randomBytes(4).toString("hex");

    const isYt = media.platform === "youtube";
    const platformEmojiHtml = settings.getPlatformEmojiHtml(media.platform);

    const cardText = buildQualityCardText({
      platform: media.platform,
      platformName: media.platformName,
      platformEmojiHtml,
      title: meta.title,
      durationSeconds: meta.duration,
      lang: userLang
    });

    const keyboard = buildQualityKeyboard(token, media.platform, urlNormalized, cache, userLang);

    let activeStatusMsgId = statusMsg.message_id;
    let isPhotoCard = false;

    // For YouTube: attempt to send a photo message with medium resolution thumbnail
    if (isYt && meta.thumbnailUrl && meta.thumbnailUrl.startsWith("https://")) {
      const ssrfCheck = await validateSafeUrl(meta.thumbnailUrl);
      if (ssrfCheck.valid) {
        try {
          const photoMsg = await ctx.replyWithPhoto(meta.thumbnailUrl, {
            caption: cardText,
            parse_mode: "HTML",
            ...keyboard
          });
          // Delete initial checking status message
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => undefined);
          activeStatusMsgId = photoMsg.message_id;
          isPhotoCard = true;
        } catch (photoErr) {
          console.warn("[youtube card] Failed to send thumbnail photo, falling back to text:", photoErr);
        }
      }
    }

    if (!isPhotoCard) {
      await ctx.telegram
        .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, cardText, {
          parse_mode: "HTML",
          ...keyboard
        })
        .catch(() => undefined);
    }

    pendingSelections.set(token, {
      userId: ctx.from.id,
      url: media.url,
      urlNormalized,
      platformName: media.platformName,
      platform: media.platform,
      title: meta.title,
      author: meta.author || meta.uploader,
      duration: meta.duration,
      filesizeApprox: meta.filesizeApprox,
      statusMsgId: activeStatusMsgId,
      isPhotoCard,
      timestamp: Date.now(),
      lang: userLang
    });
  };

  bot.on(message("text"), async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();
    await handleLinkInput(ctx, text);
  });

  // Handle Force Join callback
  bot.action(/^fj:check:([a-f0-9]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const reqId = ctx.match[1]!;
    const userLang = users.getLanguage(String(ctx.from.id));
    const pendingReq = forceJoin.getPendingRequest(reqId);

    if (!pendingReq) {
      await ctx.editMessageText(t(userLang, "err_session_expired"), { parse_mode: "HTML" }).catch(() => undefined);
      return;
    }

    const check = await forceJoin.checkMembership(bot, ctx.from.id, adminIds, pendingReq.messageText);
    if (!check.isAllowed) {
      await ctx.answerCbQuery(t(userLang, "force_join_not_yet"), { show_alert: true });
      return;
    }

    forceJoin.consumePendingRequest(reqId);
    await ctx.deleteMessage().catch(() => undefined);
    await handleLinkInput(ctx, pendingReq.messageText);
  });

  // Handle Quality Selection Callbacks
  bot.action(/^q:([a-f0-9]+):([a-z0-9]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const token = ctx.match[1]!;
    const quality = ctx.match[2]! as VideoQuality;
    const tgId = ctx.from ? String(ctx.from.id) : "";
    const userLang = users.getLanguage(tgId);

    const pending = pendingSelections.get(token);
    if (!pending) {
      await ctx
        .editMessageText(t(userLang, "err_session_expired"), {
          parse_mode: "HTML"
        })
        .catch(() => undefined);
      return;
    }

    if (pending.userId !== ctx.from.id) return;
    pendingSelections.delete(token);

    // If it was a photo card, delete the photo message and send a fresh text message for progress
    if (pending.isPhotoCard) {
      await ctx.deleteMessage().catch(() => undefined);
      const newStatus = await ctx.reply(t(userLang, "checking_link"), { parse_mode: "HTML" });
      pending.statusMsgId = newStatus.message_id;
    }

    await executePipeline({
      ctx,
      bot,
      adminIds,
      url: pending.url,
      urlNormalized: pending.urlNormalized,
      platformName: pending.platformName,
      platformKey: pending.platform,
      title: pending.title,
      author: pending.author,
      duration: pending.duration,
      quality,
      statusMsgId: pending.statusMsgId,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      cache,
      settings,
      lang: pending.lang
    });
  });

  // Handle MP3 button under videos
  bot.action(/^mp3:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const downloadId = Number(ctx.match[1]);
    const record = downloads.findById(downloadId);
    const tgId = ctx.from ? String(ctx.from.id) : "";
    const userLang = users.getLanguage(tgId);

    if (!record) {
      await ctx.reply(t(userLang, "err_record_not_found"), { parse_mode: "HTML" });
      return;
    }

    const urlNormalized = normalizeMediaUrl(record.url);
    const cached = cache.find(urlNormalized, "audio");

    if (cached && ctx.chat) {
      try {
        const platformEmoji = settings.getPlatformEmojiHtml(record.platform || "generic");
        const caption = buildFinalCaption({
          title: cached.title || "Audio",
          durationSeconds: cached.durationSeconds ?? undefined,
          fileSizeBytes: cached.fileSizeBytes || 0,
          platformName: "MP3",
          platformEmoji,
          botUsername: config.botUsername,
          isAudio: true,
          lang: userLang
        });

        await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId, {
          caption,
          parse_mode: "HTML"
        });
        return;
      } catch {
        cache.delete(urlNormalized, "audio");
      }
    }

    const statusMsg = await ctx.reply(t(userLang, "checking_link"), { parse_mode: "HTML" });
    await executePipeline({
      ctx,
      bot,
      adminIds,
      url: record.url,
      urlNormalized,
      platformName: "صوت",
      platformKey: "generic",
      quality: "audio",
      statusMsgId: statusMsg.message_id,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      cache,
      settings,
      lang: userLang
    });
  });

  bot.action("cancel", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });

  return async (ctx: any, lang: Language, url: string) => {
    await handleLinkInput(ctx, url);
  };
}

function buildQualityKeyboard(
  token: string,
  platform: string,
  urlNormalized: string,
  cache: CacheRepository,
  lang: Language
) {
  const isYt = platform === "youtube";
  const mp3Label = t(lang, "btn_get_mp3");
  const cancelLabel = t(lang, "btn_cancel");
  const downloadLabel = t(lang, "btn_download");

  if (isYt) {
    const has720 = cache.hasQuality(urlNormalized, "720p") ? "⚡ " : "";
    const has480 = cache.hasQuality(urlNormalized, "480p") ? "⚡ " : "";
    const has360 = cache.hasQuality(urlNormalized, "360p") ? "⚡ " : "";
    const hasAudio = cache.hasQuality(urlNormalized, "audio") ? "⚡ " : "";

    return Markup.inlineKeyboard([
      [
        Markup.button.callback(`${has720}720p`, `q:${token}:720p`),
        Markup.button.callback(`${has480}480p`, `q:${token}:480p`)
      ],
      [
        Markup.button.callback(`${has360}360p`, `q:${token}:360p`),
        Markup.button.callback(`${hasAudio}${mp3Label}`, `q:${token}:audio`)
      ],
      [Markup.button.callback(cancelLabel, "cancel")]
    ]);
  }

  const hasCompact = cache.hasQuality(urlNormalized, "compact") ? "⚡ " : "";
  const hasAudio = cache.hasQuality(urlNormalized, "audio") ? "⚡ " : "";

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${hasCompact}${downloadLabel}`, `q:${token}:compact`),
      Markup.button.callback(`${hasAudio}${mp3Label}`, `q:${token}:audio`)
    ],
    [Markup.button.callback(cancelLabel, "cancel")]
  ]);
}

async function handleSpotify(
  ctx: any,
  bot: Telegraf<BotContext>,
  adminIds: Set<string>,
  media: ParsedMediaUrl,
  urlNormalized: string,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository,
  lang: Language,
  settings: SettingsRepository
): Promise<void> {
  const platformEmoji = settings.getPlatformEmojiHtml("spotify");
  const cached = cache.find(urlNormalized, "audio");
  if (cached) {
    try {
      const caption = buildFinalCaption({
        title: cached.title || "Spotify Track",
        author: undefined,
        durationSeconds: cached.durationSeconds ?? undefined,
        fileSizeBytes: cached.fileSizeBytes || 0,
        platformName: "Spotify",
        platformEmoji,
        botUsername: config.botUsername,
        isAudio: true,
        lang
      });

      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId, {
        caption,
        parse_mode: "HTML"
      });
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, "Spotify");
      return;
    } catch {
      cache.delete(urlNormalized, "audio");
    }
  }

  const statusMsg = await ctx.reply(t(lang, "checking_link"), { parse_mode: "HTML" });

  try {
    const result = await downloadQueue.add(async () => {
      return await resolveSpotifyTrack(media.url, downloader);
    }, ctx.from.id);

    if (!result) {
      throw new SpotifyError("temporary_error", "Failed to resolve track");
    }

    const caption = buildFinalCaption({
      title: result.title || "Spotify Track",
      author: result.artist,
      durationSeconds: result.durationSeconds,
      fileSizeBytes: result.fileSizeBytes,
      platformName: "Spotify",
      platformEmoji,
      botUsername: config.botUsername,
      isAudio: true,
      lang
    });

    const uploadRes = await sendMediaMessage(ctx, result, caption, mtprotoUploader, undefined, undefined, {
      title: result.title,
      performer: result.artist,
      duration: result.durationSeconds
    });
    downloads.create(ctx.dbUser!.id, media.url, "success", result.fileSizeBytes, "Spotify");

    if (uploadRes) {
      cache.save({
        urlNormalized,
        quality: "audio",
        chatId: String(ctx.chat.id),
        messageId: uploadRes.messageId,
        fileSizeBytes: result.fileSizeBytes,
        mediaType: "audio",
        title: result.title,
        durationSeconds: result.durationSeconds
      });
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => undefined);
    if (result.tempDirectory) await removeDirectory(result.tempDirectory).catch(() => undefined);
  } catch (error: any) {
    downloads.create(ctx.dbUser!.id, media.url, "failed", undefined, "Spotify");
    const errorId = generateErrorId();

    let userErrorText = "";
    if (error?.code === "unsupported_type") {
      userErrorText = lang === "en"
        ? "<blockquote>⚠️ Albums, playlists and podcasts are not supported. Please send a single track link!</blockquote>"
        : "<blockquote>⚠️ لینک ارسالی مربوط به آلبوم، پلی‌لیست یا پادکست است. ربات در حال حاضر فقط از لینک تک‌آهنگ اسپاتیفای پشتیبانی می‌کند!</blockquote>";
    } else if (error?.code === "track_not_found") {
      userErrorText = lang === "en"
        ? "<blockquote>⚠️ Track could not be found. Please check the song name or send a direct link!</blockquote>"
        : "<blockquote>⚠️ آهنگ مورد نظر در منابع صوتی یافت نشد. لطفاً نام آهنگ را بررسی کرده یا لینک مستقیم بفرستید!</blockquote>";
    } else {
      userErrorText = lang === "en"
        ? `<blockquote>⚠️ Temporary server error. Please try again in a few moments.\n<code>Error ID: ${errorId}</code></blockquote>`
        : `<blockquote>⚠️ مشکل موقت در ارتباط با سرور. لطفاً چند لحظه دیگر دوباره تلاش کنید.\n<code>کد پیگیری: ${errorId}</code></blockquote>`;
    }

    await safeEditMessageText(ctx.telegram, ctx.chat.id, statusMsg.message_id, userErrorText);
    adminErrorAlerts.reportPlatformError(bot, adminIds, "Spotify", errorId, error);
    console.error(`[spotify error ${errorId}] ${ctx.from.id} ${media.url}:`, error?.message || error);
  }
}

async function handleTikTok(
  ctx: any,
  bot: Telegraf<BotContext>,
  adminIds: Set<string>,
  media: ParsedMediaUrl,
  urlNormalized: string,
  statusMsgId: number,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository,
  lang: Language,
  settings: SettingsRepository
): Promise<void> {
  const platformEmoji = settings.getPlatformEmojiHtml("tiktok");
  const cached = cache.find(urlNormalized, "compact");
  if (cached) {
    try {
      const caption = buildFinalCaption({
        title: cached.title || "TikTok",
        durationSeconds: cached.durationSeconds ?? undefined,
        fileSizeBytes: cached.fileSizeBytes || 0,
        platformName: "TikTok",
        platformEmoji,
        botUsername: config.botUsername,
        isAudio: false,
        lang
      });

      const mp3Button = Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_get_mp3"), `mp3:${cached.id}`)]]);

      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId, {
        caption,
        parse_mode: "HTML",
        ...mp3Button
      });
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, "TikTok");
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
      return;
    } catch {
      cache.delete(urlNormalized, "compact");
    }
  }

  const provider = config.tiktokProvider;

  if (provider === "tikwm_first") {
    try {
      const result = await downloadTikTokViaTikWm(media.url, {
        maxDurationSeconds: config.maxDurationSeconds,
        maxFileSizeBytes: config.telegramFileLimitBytes
      });
      if (result) {
        const caption = buildFinalCaption({
          title: result.title || "TikTok",
          author: result.author,
          durationSeconds: result.durationSeconds,
          fileSizeBytes: result.fileSizeBytes,
          platformName: "TikTok",
          platformEmoji,
          botUsername: config.botUsername,
          isAudio: false,
          lang
        });

        const downloadId = downloads.create(ctx.dbUser!.id, media.url, "success", result.fileSizeBytes, "TikTok");
        const mp3Button = Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_get_mp3"), `mp3:${downloadId}`)]]);

        const uploadRes = await sendMediaMessage(ctx, result, caption, mtprotoUploader, mp3Button);

        if (uploadRes) {
          cache.save({
            urlNormalized,
            quality: "compact",
            chatId: String(ctx.chat.id),
            messageId: uploadRes.messageId,
            fileSizeBytes: result.fileSizeBytes,
            mediaType: "video",
            title: result.title,
            durationSeconds: result.durationSeconds
          });
        }

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
        if (result.tempDirectory) await removeDirectory(result.tempDirectory).catch(() => undefined);
        return;
      }
    } catch (err) {
      console.warn("[tiktok tikwm] TikWM download failed, falling back to yt-dlp:", err);
    }
  }

  // Fallback to standard yt-dlp pipeline
  await executePipeline({
    ctx,
    bot,
    adminIds,
    url: media.url,
    urlNormalized,
    platformName: "TikTok",
    platformKey: "tiktok",
    quality: "compact",
    statusMsgId,
    downloads,
    downloader,
    downloadQueue,
    mtprotoUploader,
    cache,
    settings,
    lang
  });
}

async function handleDirectAudio(
  ctx: any,
  bot: Telegraf<BotContext>,
  adminIds: Set<string>,
  media: ParsedMediaUrl,
  urlNormalized: string,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository,
  lang: Language,
  settings: SettingsRepository
): Promise<void> {
  const platformEmoji = settings.getPlatformEmojiHtml(media.platform);
  const cached = cache.find(urlNormalized, "audio");
  if (cached) {
    try {
      const caption = buildFinalCaption({
        title: cached.title || "Audio",
        durationSeconds: cached.durationSeconds ?? undefined,
        fileSizeBytes: cached.fileSizeBytes || 0,
        platformName: media.platformName,
        platformEmoji,
        botUsername: config.botUsername,
        isAudio: true,
        lang
      });

      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId, {
        caption,
        parse_mode: "HTML"
      });
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, media.platformName);
      return;
    } catch {
      cache.delete(urlNormalized, "audio");
    }
  }

  const statusMsg = await ctx.reply(t(lang, "checking_link"), { parse_mode: "HTML" });
  await executePipeline({
    ctx,
    bot,
    adminIds,
    url: media.url,
    urlNormalized,
    platformName: media.platformName,
    platformKey: media.platform,
    quality: "audio",
    statusMsgId: statusMsg.message_id,
    downloads,
    downloader,
    downloadQueue,
    mtprotoUploader,
    cache,
    settings,
    lang
  });
}

async function handleInstagramRequest(
  ctx: any,
  bot: Telegraf<BotContext>,
  adminIds: Set<string>,
  media: ParsedMediaUrl,
  urlNormalized: string,
  statusMsgId: number,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository,
  lang: Language,
  settings: SettingsRepository
): Promise<void> {
  const platformEmoji = settings.getPlatformEmojiHtml("instagram");
  const cached = cache.find(urlNormalized, "compact");
  if (cached) {
    try {
      const caption = buildFinalCaption({
        title: cached.title || "Instagram",
        durationSeconds: cached.durationSeconds ?? undefined,
        fileSizeBytes: cached.fileSizeBytes || 0,
        platformName: "Instagram",
        platformEmoji,
        botUsername: config.botUsername,
        isAudio: false,
        lang
      });

      const mp3Button = Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_get_mp3"), `mp3:${cached.id}`)]]);

      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId, {
        caption,
        parse_mode: "HTML",
        ...mp3Button
      });
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, "Instagram");
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
      return;
    } catch {
      cache.delete(urlNormalized, "compact");
    }
  }

  const itemCount = await downloader.getMediaItemCount(media.url);

  if (itemCount <= 1) {
    await executePipeline({
      ctx,
      bot,
      adminIds,
      url: media.url,
      urlNormalized,
      platformName: "Instagram",
      platformKey: "instagram",
      quality: "compact",
      statusMsgId,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      cache,
      settings,
      lang
    });
    return;
  }

  const total = Math.min(itemCount, 10);
  await safeEditMessageText(
    ctx.telegram,
    ctx.chat.id,
    statusMsgId,
    t(lang, "carousel_detected", total)
  );

  for (let idx = 1; idx <= total; idx++) {
    let tempDirectory: string | undefined;
    try {
      const result = await downloadQueue.add(async () => {
        return await downloader.download(media.url, "compact", {
          isInstagramCarousel: true,
          playlistItem: idx
        });
      }, ctx.from.id);

      tempDirectory = result.tempDirectory;
      const caption = buildFinalCaption({
        title: t(lang, "carousel_item_title", idx, total),
        durationSeconds: result.durationSeconds,
        fileSizeBytes: result.fileSizeBytes,
        platformName: "Instagram",
        platformEmoji,
        botUsername: config.botUsername,
        isAudio: false,
        lang
      });

      await sendMediaMessage(ctx, result, caption, mtprotoUploader);
    } catch (err) {
      console.warn(`[carousel item ${idx}] failed:`, err);
      if (idx === 1) throw err;
      break;
    } finally {
      if (tempDirectory) {
        await removeDirectory(tempDirectory).catch(() => undefined);
      }
    }
  }

  downloads.create(ctx.dbUser!.id, media.url, "success", undefined, "Instagram");
  await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
}

interface PipelineOptions {
  ctx: any;
  bot: Telegraf<BotContext>;
  adminIds: Set<string>;
  url: string;
  urlNormalized: string;
  platformName: string;
  platformKey?: string;
  title?: string;
  author?: string;
  duration?: number;
  quality: VideoQuality;
  statusMsgId: number;
  downloads: DownloadsRepository;
  downloader: Downloader;
  downloadQueue: DownloadQueue;
  mtprotoUploader: MtprotoUploader;
  cache: CacheRepository;
  settings: SettingsRepository;
  lang: Language;
}

async function executePipeline(opts: PipelineOptions): Promise<void> {
  const {
    ctx,
    bot,
    adminIds,
    url,
    urlNormalized,
    platformName,
    platformKey,
    title,
    author,
    duration,
    quality,
    statusMsgId,
    downloads,
    downloader,
    downloadQueue,
    mtprotoUploader,
    cache,
    settings,
    lang
  } = opts;

  const platformEmoji = settings.getPlatformEmojiHtml(platformKey || platformName);

  // 1. Check cache first with language-localized caption (Phase 1.5)
  const cached = cache.find(urlNormalized, quality);
  if (cached) {
    try {
      await safeEditMessageText(ctx.telegram, ctx.chat.id, statusMsgId, t(lang, "cached_instant"));

      const effectiveTitle = cached.title || title || platformName;
      const isAudio = cached.mediaType === "audio" || quality === "audio";
      const caption = buildFinalCaption({
        title: effectiveTitle,
        author,
        durationSeconds: cached.durationSeconds ?? duration,
        fileSizeBytes: cached.fileSizeBytes || 0,
        platformName,
        platformEmoji,
        botUsername: config.botUsername,
        isAudio,
        lang
      });

      const mp3Button = (!isAudio && cached.mediaType === "video")
        ? Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_get_mp3"), `mp3:${cached.id}`)]])
        : undefined;

      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId, {
        caption,
        parse_mode: "HTML",
        ...mp3Button
      });

      downloads.create(ctx.dbUser!.id, url, "success", cached.fileSizeBytes ?? undefined, platformName);
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
      return;
    } catch {
      cache.delete(urlNormalized, quality);
    }
  }

  // 2. Queue position notice
  const queuePos = downloadQueue.waitingCount;
  if (queuePos > 0) {
    await safeEditMessageText(
      ctx.telegram,
      ctx.chat.id,
      statusMsgId,
      t(lang, "queue_waiting", queuePos + 1)
    );
  }

  let tempDirectory: string | undefined;
  const pipelineStartTime = Date.now();
  let downloadDurationMs = 0;
  let uploadDurationMs = 0;

  try {
    let lastDownloadPct = 0;
    const downloadStartTime = Date.now();
    const result = await downloadQueue.add(async () => {
      return await downloader.download(url, quality, {
        onProgress: (pct: number) => {
          if (pct >= lastDownloadPct + 15 || pct === 100) {
            lastDownloadPct = pct;
            safeEditMessageText(
              ctx.telegram,
              ctx.chat.id,
              statusMsgId,
              t(lang, "downloading_progress", renderProgressBar(pct)),
              undefined,
              1500
            );
          }
        }
      });
    }, ctx.from.id);

    downloadDurationMs = Date.now() - downloadStartTime;
    tempDirectory = result.tempDirectory;

    const effectiveTitle = result.title || title || platformName;
    const effectiveAuthor = result.author || author;
    const effectiveDuration = result.durationSeconds ?? duration;
    const isAudio = result.isAudio || quality === "audio";

    const caption = buildFinalCaption({
      title: effectiveTitle,
      author: effectiveAuthor,
      durationSeconds: effectiveDuration,
      fileSizeBytes: result.fileSizeBytes,
      platformName,
      platformEmoji,
      botUsername: config.botUsername,
      isAudio,
      lang
    });

    const downloadId = downloads.create(ctx.dbUser!.id, url, "success", result.fileSizeBytes, platformName);

    const mp3Button =
      !isAudio && result.mediaType === "video"
        ? Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn_get_mp3"), `mp3:${downloadId}`)]])
        : undefined;

    let lastUploadPct = 0;
    const uploadStartTime = Date.now();
    const uploadRes = await sendMediaMessage(
      ctx,
      result,
      caption,
      mtprotoUploader,
      mp3Button,
      (pct: number) => {
        if (pct >= lastUploadPct + 20 || pct === 100) {
          lastUploadPct = pct;
          safeEditMessageText(
            ctx.telegram,
            ctx.chat.id,
            statusMsgId,
            t(lang, "uploading_progress", renderProgressBar(pct)),
            undefined,
            1500
          );
        }
      },
      {
        title: effectiveTitle,
        performer: effectiveAuthor,
        duration: effectiveDuration
      },
      (waitSec: number) => {
        safeEditMessageText(
          ctx.telegram,
          ctx.chat.id,
          statusMsgId,
          t(lang, "server_busy_flood", waitSec)
        );
      }
    );
    uploadDurationMs = Date.now() - uploadStartTime;

    const totalJobMs = Date.now() - pipelineStartTime;
    const speedMBs =
      downloadDurationMs > 0
        ? (result.fileSizeBytes / (1024 * 1024)) / (downloadDurationMs / 1000)
        : 0;

    metricsManager.record({
      platform: platformName,
      metaMs: 0,
      downloadMs: downloadDurationMs,
      uploadMs: uploadDurationMs,
      totalMs: totalJobMs,
      fileSizeBytes: result.fileSizeBytes,
      speedMBs
    });

    // Save to cache
    if (uploadRes) {
      cache.save({
        urlNormalized,
        quality,
        chatId: String(ctx.chat.id),
        messageId: uploadRes.messageId,
        fileSizeBytes: result.fileSizeBytes,
        mediaType: result.mediaType,
        title: effectiveTitle,
        durationSeconds: effectiveDuration
      });

      if (config.storageChannelId) {
        try {
          const storageRes = await ctx.telegram.copyMessage(
            config.storageChannelId,
            ctx.chat.id,
            uploadRes.messageId
          );
          cache.save({
            urlNormalized,
            quality,
            chatId: config.storageChannelId,
            messageId: storageRes.message_id,
            fileSizeBytes: result.fileSizeBytes,
            mediaType: result.mediaType,
            title: effectiveTitle,
            durationSeconds: effectiveDuration
          });
        } catch (storageErr) {
          console.warn("[storage channel] Failed to copy to storage channel:", storageErr);
        }
      }
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
  } catch (error) {
    const errorId = generateErrorId();
    downloads.create(ctx.dbUser!.id, url, "failed", undefined, platformName);

    adminErrorAlerts.reportPlatformError(bot, adminIds, platformName, errorId, error);

    const errMessage = friendlyDownloadError(error, errorId, lang);
    await safeEditMessageText(
      ctx.telegram,
      ctx.chat.id,
      statusMsgId,
      `<blockquote>${escapeHtml(errMessage)}</blockquote>`
    );
    console.error(`[pipeline error ${errorId}] ${ctx.from.id} ${url}:`, error);
  } finally {
    if (tempDirectory) {
      await removeDirectory(tempDirectory).catch(() => undefined);
    }
  }
}

async function sendMediaMessage(
  ctx: any,
  result: DownloadResult,
  caption: string,
  mtprotoUploader: MtprotoUploader,
  extraMarkup?: any,
  progressCallback?: (pct: number) => void,
  audioMeta?: { title?: string; performer?: string; duration?: number },
  onFloodWaitNotice?: (seconds: number) => void
): Promise<{ messageId: number; chatId: string | number } | undefined> {
  const isAudio = result.mediaType === "audio";

  try {
    if (isAudio) {
      return await mtprotoUploader.sendAudio(
        ctx.chat.id,
        result.mediaPath,
        caption,
        result.thumbnailPath,
        progressCallback,
        audioMeta,
        onFloodWaitNotice
      );
    } else if (result.mediaType === "photo") {
      const isOversized = result.fileSizeBytes > 10 * 1024 * 1024;
      const isInvalidDims = Boolean(
        result.width &&
        result.height &&
        (result.width + result.height > 10000 ||
          result.width / result.height > 20 ||
          result.height / result.width > 20)
      );

      if (isOversized || isInvalidDims) {
        return await mtprotoUploader.sendDocument(ctx.chat.id, result.mediaPath, caption, onFloodWaitNotice);
      }
      return await mtprotoUploader.sendPhoto(ctx.chat.id, result.mediaPath, caption, onFloodWaitNotice);
    } else {
      const res = await mtprotoUploader.sendVideo(
        ctx.chat.id,
        result.mediaPath,
        caption,
        result.thumbnailPath,
        progressCallback,
        { duration: result.durationSeconds },
        onFloodWaitNotice
      );
      if (extraMarkup) {
        await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, res.messageId, undefined, extraMarkup.reply_markup).catch(() => undefined);
      }
      return res;
    }
  } catch (err) {
    console.warn("[upload] MTProto upload failed, falling back to HTTP Bot API:", err);
  }

  // Telegraf HTTP Fallback
  if (isAudio) {
    const msg = await ctx.replyWithAudio(Input.fromLocalFile(result.mediaPath), {
      ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
      title: audioMeta?.title,
      performer: audioMeta?.performer,
      duration: audioMeta?.duration,
      caption,
      parse_mode: "HTML",
      ...extraMarkup
    });
    return { messageId: msg.message_id, chatId: ctx.chat.id };
  } else if (result.mediaType === "photo") {
    const isOversized = result.fileSizeBytes > 10 * 1024 * 1024;
    const isInvalidDims = Boolean(
      result.width &&
      result.height &&
      (result.width + result.height > 10000 ||
        result.width / result.height > 20 ||
        result.height / result.width > 20)
    );

    if (isOversized || isInvalidDims) {
      const msg = await ctx.replyWithDocument(Input.fromLocalFile(result.mediaPath), {
        caption,
        parse_mode: "HTML",
        ...extraMarkup
      });
      return { messageId: msg.message_id, chatId: ctx.chat.id };
    }

    const msg = await ctx.replyWithPhoto(Input.fromLocalFile(result.mediaPath), {
      caption,
      parse_mode: "HTML",
      ...extraMarkup
    });
    return { messageId: msg.message_id, chatId: ctx.chat.id };
  } else {
    const msg = await ctx.replyWithVideo(Input.fromLocalFile(result.mediaPath), {
      ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
      supports_streaming: true,
      caption,
      parse_mode: "HTML",
      ...extraMarkup
    });
    return { messageId: msg.message_id, chatId: ctx.chat.id };
  }
}
