import crypto from "node:crypto";
import { Input, Markup, type Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "../../config.js";
import type { CacheRepository } from "../../database/repositories/cache.js";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { DownloadQueue } from "../../services/downloadQueue.js";
import type { Downloader, VideoQuality } from "../../services/downloader.js";
import type { MtprotoUploader } from "../../services/mtprotoUploader.js";
import type { RateLimiter } from "../../services/rateLimiter.js";
import { resolveSpotifyTrack } from "../../services/spotify.js";
import { downloadTikTokViaTikWm } from "../../services/tiktok.js";
import type { BotContext, DownloadResult } from "../../types/index.js";
import { removeDirectory } from "../../utils/files.js";
import {
  escapeHtml,
  formatBytes,
  formatDuration,
  renderProgressBar,
  truncateText
} from "../../utils/formatting.js";
import { parseMediaUrl, type ParsedMediaUrl } from "../../utils/mediaUrl.js";
import { friendlyDownloadError } from "../../utils/telegramErrors.js";
import { safeEditMessageText } from "../../utils/throttler.js";
import { normalizeMediaUrl } from "../../utils/urlNormalizer.js";

interface PendingSelection {
  userId: number;
  url: string;
  urlNormalized: string;
  platformName: string;
  title: string;
  author?: string;
  duration?: number;
  filesizeApprox?: number;
  statusMsgId: number;
  timestamp: number;
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

export function buildFinalCaption(opts: {
  title: string;
  author?: string;
  durationSeconds?: number;
  fileSizeBytes: number;
  platformName: string;
  botUsername: string;
}): string {
  const titleLine = `🎬 <b>${escapeHtml(truncateText(opts.title, 80))}</b>`;
  const authorLine = opts.author ? `👤 <i>${escapeHtml(opts.author)}</i>\n` : "";

  const durationPart =
    opts.durationSeconds && opts.durationSeconds > 0
      ? `⏱ مدت: <code>${formatDuration(opts.durationSeconds)}</code> │ `
      : "";
  const sizePart = `💾 حجم: <code>${formatBytes(opts.fileSizeBytes)}</code>`;
  const statsBlock = `<blockquote>${durationPart}${sizePart}\n🌐 ${opts.platformName}</blockquote>`;

  return [titleLine, authorLine, statsBlock, `🤖 @${opts.botUsername}`].filter(Boolean).join("\n");
}

export function registerDownloadHandler(
  bot: Telegraf<BotContext>,
  downloads: DownloadsRepository,
  downloader: Downloader,
  rateLimiter: RateLimiter,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository
): void {
  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const media = await parseMediaUrl(text);
    if (!media) {
      await ctx.reply(
        "<b>✕ خطا:</b> لینک ارسالی نامعتبر است.\nلطفاً یک لینک معتبر اینترنتی ارسال کنید.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const rate = rateLimiter.consume(String(ctx.from.id));
    if (!rate.allowed) {
      await ctx.reply(
        `⏳ لطفاً پس از <code>${rate.retryAfterSeconds}</code> ثانیه دوباره تلاش کنید.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const urlNormalized = normalizeMediaUrl(media.url);

    // 1. Handle Spotify intelligently
    if (media.platform === "spotify") {
      await handleSpotify(ctx, media, urlNormalized, downloads, downloader, downloadQueue, mtprotoUploader, cache);
      return;
    }

    // 2. Direct audio request via "mp3 <url>"
    if (media.isAudioRequested) {
      await handleDirectAudio(ctx, media, urlNormalized, downloads, downloader, downloadQueue, mtprotoUploader, cache);
      return;
    }

    // 3. Status message
    const statusMsg = await ctx.reply("▸ در حال بررسی لینک... ⏳", { parse_mode: "HTML" });

    // 4. Handle TikTok with TikWM
    if (media.platform === "tiktok") {
      await handleTikTok(
        ctx,
        media,
        urlNormalized,
        statusMsg.message_id,
        downloads,
        downloader,
        downloadQueue,
        mtprotoUploader,
        cache
      );
      return;
    }

    // 5. Handle Instagram
    if (media.platform === "instagram") {
      await handleInstagramRequest(
        ctx,
        media,
        urlNormalized,
        statusMsg.message_id,
        downloads,
        downloader,
        downloadQueue,
        mtprotoUploader,
        cache
      );
      return;
    }

    // 6. YouTube and other platforms
    cleanupPending();
    const meta = await downloader.fetchMetadata(media.url);
    const token = crypto.randomBytes(4).toString("hex");

    pendingSelections.set(token, {
      userId: ctx.from.id,
      url: media.url,
      urlNormalized,
      platformName: media.platformName,
      title: meta.title,
      author: meta.uploader,
      duration: meta.duration,
      filesizeApprox: meta.filesizeApprox,
      statusMsgId: statusMsg.message_id,
      timestamp: Date.now()
    });

    const durationBlock = meta.duration && meta.duration > 0
      ? ` │ مدت: <code>${formatDuration(meta.duration)}</code>`
      : "";

    const cardText = [
      `<b>${escapeHtml(truncateText(meta.title, 80))}</b>`,
      `<blockquote>منبع: ${media.platformName}${durationBlock}</blockquote>`
    ].join("\n");

    const keyboard = buildQualityKeyboard(token, media.platform, urlNormalized, cache);

    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, cardText, {
        parse_mode: "HTML",
        ...keyboard
      })
      .catch(() => undefined);
  });

  // Handle Quality Selection Callbacks
  bot.action(/^q:([a-f0-9]+):([a-z0-9]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const token = ctx.match[1]!;
    const quality = ctx.match[2]! as VideoQuality;

    const pending = pendingSelections.get(token);
    if (!pending) {
      await ctx
        .editMessageText("⏳ نشست منقضی شده است. لطفاً لینک را دوباره ارسال کنید.", {
          parse_mode: "HTML"
        })
        .catch(() => undefined);
      return;
    }

    if (pending.userId !== ctx.from.id) return;
    pendingSelections.delete(token);

    await executePipeline({
      ctx,
      url: pending.url,
      urlNormalized: pending.urlNormalized,
      platformName: pending.platformName,
      title: pending.title,
      author: pending.author,
      duration: pending.duration,
      quality,
      statusMsgId: pending.statusMsgId,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      cache
    });
  });

  // Handle MP3 button under videos
  bot.action(/^mp3:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("در حال دریافت نسخه صوتی... ⏳");
    const downloadId = Number(ctx.match[1]);
    const record = downloads.findById(downloadId);

    if (!record) {
      await ctx.reply("✕ رکورد دانلود یافت نشد.", { parse_mode: "HTML" });
      return;
    }

    const urlNormalized = normalizeMediaUrl(record.url);
    const cached = cache.find(urlNormalized, "audio");

    if (cached && ctx.chat) {
      try {
        await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId);
        return;
      } catch {
        cache.delete(urlNormalized, "audio");
      }
    }

    const statusMsg = await ctx.reply("▸ در حال استخراج MP3... ⏳", { parse_mode: "HTML" });
    await executePipeline({
      ctx,
      url: record.url,
      urlNormalized,
      platformName: "صوت",
      quality: "audio",
      statusMsgId: statusMsg.message_id,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      cache
    });
  });

  bot.action("cancel", async (ctx) => {
    await ctx.answerCbQuery("عملیات لغو شد.");
    await ctx.deleteMessage().catch(() => undefined);
  });
}

function buildQualityKeyboard(
  token: string,
  platform: string,
  urlNormalized: string,
  cache: CacheRepository
) {
  const isYt = platform === "youtube";

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
        Markup.button.callback(`${hasAudio}MP3`, `q:${token}:audio`)
      ],
      [Markup.button.callback("✕ لغو", "cancel")]
    ]);
  }

  const hasCompact = cache.hasQuality(urlNormalized, "compact") ? "⚡ " : "";
  const hasAudio = cache.hasQuality(urlNormalized, "audio") ? "⚡ " : "";

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${hasCompact}دانلود`, `q:${token}:compact`),
      Markup.button.callback(`${hasAudio}MP3`, `q:${token}:audio`)
    ],
    [Markup.button.callback("✕ لغو", "cancel")]
  ]);
}

async function handleSpotify(
  ctx: any,
  media: ParsedMediaUrl,
  urlNormalized: string,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository
): Promise<void> {
  const cached = cache.find(urlNormalized, "audio");
  if (cached) {
    try {
      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId);
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, "Spotify");
      return;
    } catch {
      cache.delete(urlNormalized, "audio");
    }
  }

  const statusMsg = await ctx.reply("▸ در حال استخراج موزیک از اسپاتیفای... ⏳", { parse_mode: "HTML" });

  try {
    const result = await downloadQueue.add(async () => {
      return await resolveSpotifyTrack(media.url, downloader);
    });

    if (!result) {
      throw new Error("spotify_drm");
    }

    const caption = buildFinalCaption({
      title: result.title || "موزیک اسپاتیفای",
      author: result.artist,
      durationSeconds: result.durationSeconds,
      fileSizeBytes: result.fileSizeBytes,
      platformName: "Spotify",
      botUsername: config.botUsername
    });

    const uploadRes = await sendMediaMessage(ctx, result, caption, mtprotoUploader);
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
  } catch {
    downloads.create(ctx.dbUser!.id, media.url, "failed", undefined, "Spotify");
    await safeEditMessageText(
      ctx.telegram,
      ctx.chat.id,
      statusMsg.message_id,
      "<blockquote>⚠️ آهنگ‌های مستقیم اسپاتیفای قفل هستند و نمیشه مستقیم دانلودشون کرد. لطفاً اسم آهنگ یا لینکش از یوتیوب/ساندکلاد رو بفرست تا فوری تحویل بدم!</blockquote>"
    );
  }
}

async function handleTikTok(
  ctx: any,
  media: ParsedMediaUrl,
  urlNormalized: string,
  statusMsgId: number,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository
): Promise<void> {
  // Check cache first
  const cached = cache.find(urlNormalized, "compact");
  if (cached) {
    try {
      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId);
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, "TikTok");
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
      return;
    } catch {
      cache.delete(urlNormalized, "compact");
    }
  }

  // Fast TikWM attempt
  try {
    const result = await downloadTikTokViaTikWm(media.url);
    if (result) {
      const caption = buildFinalCaption({
        title: result.title || "تیک‌تاک",
        author: result.author,
        durationSeconds: result.durationSeconds,
        fileSizeBytes: result.fileSizeBytes,
        platformName: "TikTok",
        botUsername: config.botUsername
      });

      const downloadId = downloads.create(ctx.dbUser!.id, media.url, "success", result.fileSizeBytes, "TikTok");
      const mp3Button = Markup.inlineKeyboard([[Markup.button.callback("🎵 دریافت MP3", `mp3:${downloadId}`)]]);

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
    console.warn("[tiktok tikwm] Fast download failed, falling back to pipeline:", err);
  }

  // Fallback to standard yt-dlp pipeline
  await executePipeline({
    ctx,
    url: media.url,
    urlNormalized,
    platformName: "TikTok",
    quality: "compact",
    statusMsgId,
    downloads,
    downloader,
    downloadQueue,
    mtprotoUploader,
    cache
  });
}

async function handleDirectAudio(
  ctx: any,
  media: ParsedMediaUrl,
  urlNormalized: string,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository
): Promise<void> {
  const cached = cache.find(urlNormalized, "audio");
  if (cached) {
    try {
      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId);
      downloads.create(ctx.dbUser!.id, media.url, "success", cached.fileSizeBytes ?? undefined, media.platformName);
      return;
    } catch {
      cache.delete(urlNormalized, "audio");
    }
  }

  const statusMsg = await ctx.reply("▸ در حال استخراج MP3... ⏳", { parse_mode: "HTML" });
  await executePipeline({
    ctx,
    url: media.url,
    urlNormalized,
    platformName: media.platformName,
    quality: "audio",
    statusMsgId: statusMsg.message_id,
    downloads,
    downloader,
    downloadQueue,
    mtprotoUploader,
    cache
  });
}

async function handleInstagramRequest(
  ctx: any,
  media: ParsedMediaUrl,
  urlNormalized: string,
  statusMsgId: number,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader: MtprotoUploader,
  cache: CacheRepository
): Promise<void> {
  const cached = cache.find(urlNormalized, "compact");
  if (cached) {
    try {
      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId);
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
      url: media.url,
      urlNormalized,
      platformName: "Instagram",
      quality: "compact",
      statusMsgId,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      cache
    });
    return;
  }

  const total = Math.min(itemCount, 10);
  await safeEditMessageText(
    ctx.telegram,
    ctx.chat.id,
    statusMsgId,
    `📸 آلبوم اینستاگرام شامل <code>${total}</code> آیتم شناسایی شد.\nدر حال دریافت و ارسال تک‌تک... ⏳`
  );

  for (let idx = 1; idx <= total; idx++) {
    let tempDirectory: string | undefined;
    try {
      const result = await downloadQueue.add(async () => {
        return await downloader.download(media.url, "compact", {
          isInstagramCarousel: true,
          playlistItem: idx
        });
      });

      tempDirectory = result.tempDirectory;
      const caption = buildFinalCaption({
        title: `اینستاگرام (آیتم ${idx} از ${total})`,
        durationSeconds: result.durationSeconds,
        fileSizeBytes: result.fileSizeBytes,
        platformName: "Instagram",
        botUsername: config.botUsername
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
  url: string;
  urlNormalized: string;
  platformName: string;
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
}

async function executePipeline(opts: PipelineOptions): Promise<void> {
  const {
    ctx,
    url,
    urlNormalized,
    platformName,
    title,
    author,
    duration,
    quality,
    statusMsgId,
    downloads,
    downloader,
    downloadQueue,
    mtprotoUploader,
    cache
  } = opts;

  // 1. Check cache first
  const cached = cache.find(urlNormalized, quality);
  if (cached) {
    try {
      await safeEditMessageText(ctx.telegram, ctx.chat.id, statusMsgId, "⚡ در حال ارسال فوری از کش...");
      await ctx.telegram.copyMessage(ctx.chat.id, cached.chatId, cached.messageId);
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
      `⏳ در نوبت دانلود (نفر <code>${queuePos + 1}</code>)...`
    );
  }

  let tempDirectory: string | undefined;
  try {
    let lastDownloadPct = 0;
    const result = await downloadQueue.add(async () => {
      return await downloader.download(url, quality, {
        onProgress: (pct: number) => {
          if (pct >= lastDownloadPct + 15 || pct === 100) {
            lastDownloadPct = pct;
            safeEditMessageText(
              ctx.telegram,
              ctx.chat.id,
              statusMsgId,
              `▸ در حال دانلود... ⚡\n<code>${renderProgressBar(pct)}</code>`,
              undefined,
              1500
            );
          }
        }
      });
    });

    tempDirectory = result.tempDirectory;

    const effectiveTitle = result.title || title || platformName;
    const effectiveDuration = result.durationSeconds ?? duration;

    const caption = buildFinalCaption({
      title: effectiveTitle,
      author,
      durationSeconds: effectiveDuration,
      fileSizeBytes: result.fileSizeBytes,
      platformName,
      botUsername: config.botUsername
    });

    const downloadId = downloads.create(ctx.dbUser!.id, url, "success", result.fileSizeBytes, platformName);

    const mp3Button =
      result.mediaType === "video"
        ? Markup.inlineKeyboard([[Markup.button.callback("🎵 دریافت MP3", `mp3:${downloadId}`)]])
        : undefined;

    let lastUploadPct = 0;
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
            `▸ در حال آپلود... 📤\n<code>${renderProgressBar(pct)}</code>`,
            undefined,
            1500
          );
        }
      }
    );

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
    downloads.create(ctx.dbUser!.id, url, "failed", undefined, platformName);
    const errMessage = friendlyDownloadError(error);
    await safeEditMessageText(
      ctx.telegram,
      ctx.chat.id,
      statusMsgId,
      `<blockquote>${escapeHtml(errMessage)}</blockquote>`
    );
    console.error(`[pipeline error] ${ctx.from.id} ${url}:`, error);
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
  progressCallback?: (pct: number) => void
): Promise<{ messageId: number; chatId: string | number } | undefined> {
  try {
    if (result.mediaType === "audio") {
      return await mtprotoUploader.sendAudio(ctx.chat.id, result.mediaPath, caption, result.thumbnailPath, progressCallback);
    } else if (result.mediaType === "photo") {
      return await mtprotoUploader.sendPhoto(ctx.chat.id, result.mediaPath, caption);
    } else {
      const res = await mtprotoUploader.sendVideo(ctx.chat.id, result.mediaPath, caption, result.thumbnailPath, progressCallback);
      if (extraMarkup) {
        await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, res.messageId, undefined, extraMarkup.reply_markup).catch(() => undefined);
      }
      return res;
    }
  } catch (err) {
    console.warn("[upload] MTProto upload failed, falling back to HTTP Bot API:", err);
  }

  // Telegraf HTTP Fallback
  if (result.mediaType === "audio") {
    const msg = await ctx.replyWithAudio(Input.fromLocalFile(result.mediaPath), {
      ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
      caption,
      parse_mode: "HTML",
      ...extraMarkup
    });
    return { messageId: msg.message_id, chatId: ctx.chat.id };
  } else if (result.mediaType === "photo") {
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
