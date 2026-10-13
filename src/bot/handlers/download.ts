import { Input, Markup, type Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { DownloadQueue } from "../../services/downloadQueue.js";
import type { Downloader, VideoQuality } from "../../services/downloader.js";
import type { MtprotoUploader } from "../../services/mtprotoUploader.js";
import type { RateLimiter } from "../../services/rateLimiter.js";
import type { BotContext, DownloadResult } from "../../types/index.js";
import { removeDirectory } from "../../utils/files.js";
import { parseMediaUrl, type ParsedMediaUrl } from "../../utils/mediaUrl.js";
import { friendlyDownloadError } from "../../utils/telegramErrors.js";
import { mainReplyKeyboard } from "./start.js";

// Pending download selections (User ID -> ParsedMediaUrl)
const pendingSelection = new Map<number, { parsed: ParsedMediaUrl; timestamp: number }>();

function cleanupPending(): void {
  const now = Date.now();
  for (const [userId, item] of pendingSelection.entries()) {
    if (now - item.timestamp > 10 * 60 * 1000) {
      pendingSelection.delete(userId);
    }
  }
}

export function registerDownloadHandler(
  bot: Telegraf<BotContext>,
  downloads: DownloadsRepository,
  downloader: Downloader,
  rateLimiter: RateLimiter,
  downloadQueue: DownloadQueue,
  mtprotoUploader?: MtprotoUploader
): void {
  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    if (["زبان 🌐", "بازخورد 📝", "منو 📋", "راهنما ❓"].includes(text)) {
      return;
    }

    const media = await parseMediaUrl(text);
    if (!media) {
      await ctx.reply(
        "لطفاً یک لینک اینترنتی معتبر (از یوتیوب، اینستاگرام، تیک‌تاک، توییتر و ...) ارسال کنید. 📥",
        mainReplyKeyboard
      );
      return;
    }

    const rate = rateLimiter.consume(String(ctx.from.id));
    if (!rate.allowed) {
      await ctx.reply(
        `تعداد درخواست‌ها بیش از حد مجاز است. لطفاً پس از ${rate.retryAfterSeconds} ثانیه دوباره تلاش کنید.`
      );
      return;
    }

    // Direct audio request via "mp3 <url>"
    if (media.isAudioRequested) {
      await executeDownload(ctx, media, "audio", downloads, downloader, downloadQueue, mtprotoUploader);
      return;
    }

    // For YouTube: present quality selector
    if (media.platform === "youtube") {
      cleanupPending();
      pendingSelection.set(ctx.from.id, { parsed: media, timestamp: Date.now() });

      await ctx.reply(
        `🎬 **انتخاب کیفیت دانلود (${media.platformName}):**`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("🎬 720p (عالی)", "q_720p"),
            Markup.button.callback("📹 480p (بهینه)", "q_480p")
          ],
          [
            Markup.button.callback("📱 360p (کم‌حجم)", "q_360p"),
            Markup.button.callback("🎵 فقط صدا (MP3)", "q_audio")
          ],
          [Markup.button.callback("لغو ❌", "cancel_download")]
        ])
      );
      return;
    }

    // For Instagram: handle single post or carousel
    if (media.platform === "instagram") {
      await executeInstagramDownload(ctx, media, downloads, downloader, downloadQueue, mtprotoUploader);
      return;
    }

    // For all other platforms: automatic best single file <= 720p
    await executeDownload(ctx, media, "compact", downloads, downloader, downloadQueue, mtprotoUploader);
  });

  // Handle Quality Selection Callbacks (for YouTube)
  const handleQualityChoice = (quality: VideoQuality) => async (ctx: any) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const pending = pendingSelection.get(userId);

    if (!pending) {
      await ctx.editMessageText("❌ نشست دانلود منقضی شده است. لطفاً لینک را دوباره ارسال کنید.");
      return;
    }

    pendingSelection.delete(userId);
    await ctx.editMessageText("در حال اضافه شدن به صف پردازش... ⏳");
    await executeDownload(
      ctx,
      pending.parsed,
      quality,
      downloads,
      downloader,
      downloadQueue,
      mtprotoUploader,
      ctx.callbackQuery.message.message_id
    );
  };

  bot.action("q_720p", handleQualityChoice("720p"));
  bot.action("q_480p", handleQualityChoice("480p"));
  bot.action("q_360p", handleQualityChoice("360p"));
  bot.action("q_audio", handleQualityChoice("audio"));

  bot.action("cancel_download", async (ctx) => {
    await ctx.answerCbQuery("عملیات لغو شد.");
    if (ctx.from) pendingSelection.delete(ctx.from.id);
    await ctx.editMessageText("❌ درخواست دانلود لغو شد.").catch(() => undefined);
  });

  bot.action("status_ready", async (ctx) => {
    await ctx.answerCbQuery("فایل با موفقیت ارسال شد!");
  });
}

/**
 * Executes download and upload for Instagram, including carousel support up to 10 items.
 * Processes and sends one item at a time, immediately unlinking each file to respect disk limits.
 */
async function executeInstagramDownload(
  ctx: any,
  media: ParsedMediaUrl,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader?: MtprotoUploader
): Promise<void> {
  const status = await ctx.reply("در حال بررسی پست اینستاگرام... ⏳");
  const statusMsgId = status.message_id;

  try {
    let sentCount = 0;
    // Process items one by one (up to 10 items)
    for (let itemIndex = 1; itemIndex <= 10; itemIndex++) {
      let tempDirectory: string | undefined;
      try {
        const result = await downloadQueue.add(async () => {
          if (itemIndex === 1) {
            await ctx.telegram
              .editMessageText(
                ctx.chat.id,
                statusMsgId,
                undefined,
                "در حال دانلود از اینستاگرام... ⚡️"
              )
              .catch(() => undefined);
          }
          return await downloader.download(media.url, "compact", {
            isInstagramCarousel: true,
            playlistItem: itemIndex
          });
        });

        tempDirectory = result.tempDirectory;
        const caption =
          itemIndex > 1
            ? `📸 [${media.platformName}] آیتم شماره ${itemIndex}\n@mimo_downloader_bot`
            : `🎬 [${media.platformName}] دریافت شد.\n@mimo_downloader_bot`;

        await sendMediaToUser(ctx, result, caption, mtprotoUploader);
        sentCount++;
      } catch (itemErr: any) {
        // If first item failed, rethrow to surface error.
        // If subsequent items fail, it means no more carousel items exist.
        if (itemIndex === 1) throw itemErr;
        break;
      } finally {
        if (tempDirectory) {
          await removeDirectory(tempDirectory).catch(() => undefined);
        }
      }
    }

    downloads.create(ctx.dbUser!.id, media.url, "success");
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
  } catch (error) {
    downloads.create(ctx.dbUser!.id, media.url, "failed");
    const errMessage = friendlyDownloadError(error);
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsgId, undefined, `❌ خطا در دانلود:\n${errMessage}`)
      .catch(() => ctx.reply(`❌ خطا در دانلود:\n${errMessage}`));
    console.error(`[download instagram] ${ctx.from.id} ${media.url}:`, error);
  }
}

/**
 * Standard single download and upload pipeline for any platform.
 */
async function executeDownload(
  ctx: any,
  media: ParsedMediaUrl,
  quality: VideoQuality,
  downloads: DownloadsRepository,
  downloader: Downloader,
  downloadQueue: DownloadQueue,
  mtprotoUploader?: MtprotoUploader,
  existingStatusMsgId?: number
): Promise<void> {
  let statusMsgId = existingStatusMsgId;
  if (!statusMsgId) {
    const queueMsg = downloadQueue.waitingCount > 0 ? ` (نفر ${downloadQueue.waitingCount} در صف)` : "";
    const status = await ctx.reply(
      `در حال اتصال به ${media.platformName}${queueMsg}... ⏳`,
      Markup.inlineKeyboard([[Markup.button.callback("لغو عملیات ❌", "cancel_download")]])
    );
    statusMsgId = status.message_id;
  }

  let tempDirectory: string | undefined;
  try {
    const result = await downloadQueue.add(async () => {
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          statusMsgId,
          undefined,
          `در حال دانلود از ${media.platformName} با بیشترین سرعت... ⚡️`,
          Markup.inlineKeyboard([[Markup.button.callback("لغو عملیات ❌", "cancel_download")]])
        )
        .catch(() => undefined);

      return await downloader.download(media.url, quality);
    });

    tempDirectory = result.tempDirectory;

    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        statusMsgId,
        undefined,
        "در حال ارسال فایل به تلگرام... 📤",
        Markup.inlineKeyboard([[Markup.button.callback("وضعیت: آماده ✅", "status_ready")]])
      )
      .catch(() => undefined);

    const icon = result.mediaType === "audio" ? "🎵" : result.mediaType === "photo" ? "🖼" : "🎬";
    const caption = `${icon} [${media.platformName}] با موفقیت دانلود شد.\n@mimo_downloader_bot`;

    await sendMediaToUser(ctx, result, caption, mtprotoUploader);

    downloads.create(ctx.dbUser!.id, media.url, "success", result.fileSizeBytes);
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
  } catch (error) {
    downloads.create(ctx.dbUser!.id, media.url, "failed");
    const errMessage = friendlyDownloadError(error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        statusMsgId,
        undefined,
        `❌ خطا در دانلود:\n${errMessage}`,
        Markup.inlineKeyboard([[Markup.button.callback("راهنمایی ℹ️", "btn_help")]])
      )
      .catch(() => ctx.reply(`❌ خطا در دانلود:\n${errMessage}`));
    console.error(`[download] ${ctx.from.id} ${media.url}:`, error);
  } finally {
    if (tempDirectory) {
      await removeDirectory(tempDirectory).catch(() => undefined);
    }
  }
}

/**
 * Sends downloaded media (video, audio, or photo) via MTProto or HTTP fallback.
 */
async function sendMediaToUser(
  ctx: any,
  result: DownloadResult,
  caption: string,
  mtprotoUploader?: MtprotoUploader
): Promise<void> {
  if (mtprotoUploader) {
    try {
      if (result.mediaType === "audio") {
        await mtprotoUploader.sendAudio(ctx.chat.id, result.mediaPath, caption, result.thumbnailPath);
      } else if (result.mediaType === "photo") {
        await mtprotoUploader.sendPhoto(ctx.chat.id, result.mediaPath, caption);
      } else {
        await mtprotoUploader.sendVideo(ctx.chat.id, result.mediaPath, caption, result.thumbnailPath);
      }
      return;
    } catch (uploadErr) {
      console.warn("[upload] MTProto upload failed, falling back to HTTP Bot API:", uploadErr);
    }
  }

  // Telegraf HTTP Fallback
  if (result.mediaType === "audio") {
    await ctx.replyWithAudio(Input.fromLocalFile(result.mediaPath), {
      ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
      caption
    });
  } else if (result.mediaType === "photo") {
    await ctx.replyWithPhoto(Input.fromLocalFile(result.mediaPath), {
      caption
    });
  } else {
    await ctx.replyWithVideo(Input.fromLocalFile(result.mediaPath), {
      ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
      supports_streaming: true,
      caption
    });
  }
}
