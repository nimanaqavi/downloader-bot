import { Input, Markup, type Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import type { DownloadsRepository } from "../../database/repositories/downloads.js";
import type { DownloadQueue } from "../../services/downloadQueue.js";
import type { Downloader, VideoQuality } from "../../services/downloader.js";
import type { MtprotoUploader } from "../../services/mtprotoUploader.js";
import type { RateLimiter } from "../../services/rateLimiter.js";
import type { BotContext } from "../../types/index.js";
import { removeDirectory } from "../../utils/files.js";
import { parseMediaUrl } from "../../utils/mediaUrl.js";
import { friendlyDownloadError } from "../../utils/telegramErrors.js";
import { mainReplyKeyboard } from "./start.js";

// Pending YouTube download selections (User ID -> URL)
const pendingSelection = new Map<number, { url: string; timestamp: number }>();

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

    const media = parseMediaUrl(text);
    if (!media) {
      await ctx.reply(
        "لطفاً یک لینک معتبر از اینستاگرام یا یوتیوب ارسال کنید. 📥",
        mainReplyKeyboard
      );
      return;
    }

    const rate = rateLimiter.consume(String(ctx.from.id));
    if (!rate.allowed) {
      await ctx.reply(`تعداد درخواست‌ها بیش از حد مجاز است. لطفاً پس از ${rate.retryAfterSeconds} ثانیه دوباره تلاش کنید.`);
      return;
    }

    // For YouTube (all videos & shorts), ask user to select quality
    if (media.platform === "youtube") {
      cleanupPending();
      pendingSelection.set(ctx.from.id, { url: media.url, timestamp: Date.now() });

      await ctx.reply(
        "🎬 **کیفیت و فرمت دانلود را انتخاب کنید:**",
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

    // For Instagram, execute direct optimized download via queue
    await executeDownload(ctx, media.url, "compact", downloads, downloader, downloadQueue, mtprotoUploader);
  });

  // Handle Quality Selection Callbacks
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
    await executeDownload(ctx, pending.url, quality, downloads, downloader, downloadQueue, mtprotoUploader, ctx.callbackQuery.message.message_id);
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

async function executeDownload(
  ctx: any,
  url: string,
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
      `در حال بررسی و آماده‌سازی${queueMsg}... ⏳`,
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
          "در حال دانلود و پردازش با نهایت سرعت... ⚡️",
          Markup.inlineKeyboard([[Markup.button.callback("لغو عملیات ❌", "cancel_download")]])
        )
        .catch(() => undefined);

      return await downloader.download(url, quality);
    });

    tempDirectory = result.tempDirectory;

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsgId,
      undefined,
      "در حال ارسال فایل به تلگرام... 📤",
      Markup.inlineKeyboard([[Markup.button.callback("وضعیت: آماده ✅", "status_ready")]])
    );

    const caption = result.isAudio
      ? "🎵 فایل صوتی با موفقیت دریافت شد.\n@mimo_downloader_bot"
      : "🎬 ویدیو با موفقیت دانلود شد.\n@mimo_downloader_bot";

    // ALWAYS use high-speed 16-worker MTProto Uploader if available
    if (mtprotoUploader) {
      try {
        if (result.isAudio) {
          await mtprotoUploader.sendAudio(ctx.chat.id, result.videoPath, caption, result.thumbnailPath);
        } else {
          await mtprotoUploader.sendVideo(ctx.chat.id, result.videoPath, caption, result.thumbnailPath);
        }
      } catch (uploadErr) {
        console.warn("[upload] MTProto upload failed, falling back to HTTP Bot API:", uploadErr);
        if (result.isAudio) {
          await ctx.replyWithAudio(Input.fromLocalFile(result.videoPath), {
            ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
            caption
          });
        } else {
          await ctx.replyWithVideo(Input.fromLocalFile(result.videoPath), {
            ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
            supports_streaming: true,
            caption
          });
        }
      }
    } else {
      if (result.isAudio) {
        await ctx.replyWithAudio(Input.fromLocalFile(result.videoPath), {
          ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
          caption
        });
      } else {
        await ctx.replyWithVideo(Input.fromLocalFile(result.videoPath), {
          ...(result.thumbnailPath ? { thumbnail: Input.fromLocalFile(result.thumbnailPath) } : {}),
          supports_streaming: true,
          caption
        });
      }
    }

    downloads.create(ctx.dbUser!.id, url, "success", result.fileSizeBytes);
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId).catch(() => undefined);
  } catch (error) {
    downloads.create(ctx.dbUser!.id, url, "failed");
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
    console.error(`[download] ${ctx.from.id} ${url}:`, error);
  } finally {
    if (tempDirectory) {
      await removeDirectory(tempDirectory).catch(() => undefined);
    }
  }
}
