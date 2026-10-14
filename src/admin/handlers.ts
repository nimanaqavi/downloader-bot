import { existsSync, readFileSync } from "node:fs";
import { Markup, type Telegraf } from "telegraf";
import { config } from "../config.js";
import type { CacheRepository } from "../database/repositories/cache.js";
import type { DownloadsRepository } from "../database/repositories/downloads.js";
import type { SettingsRepository } from "../database/repositories/settings.js";
import type { UsersRepository } from "../database/repositories/users.js";
import { getYtDlpStatus } from "../services/dependencies.js";
import type { DownloadQueue } from "../services/downloadQueue.js";
import { gramjsMonitor } from "../services/gramjsMonitor.js";
import { metricsManager } from "../services/metrics.js";
import { tikWmCircuit } from "../services/tiktok.js";
import type { BotContext, User } from "../types/index.js";
import { getAccountUsedMb } from "../utils/disk.js";
import { escapeHtml, formatBytes, renderProgressBar } from "../utils/formatting.js";
import { sanitizeLog } from "../utils/telegramErrors.js";
import { BroadcastManager } from "./broadcast.js";
import { adminMenu, backToAdmin } from "./menus.js";

const PAGE_SIZE = 8;
const HISTORY_SIZE = 6;
const formatDate = (value: string) => `${value.replace("T", " ").replace(".000Z", "")} UTC`;
const displayName = (user: User) => (user.username ? `@${user.username}` : `ID ${user.telegramId}`);

export function registerAdminHandlers(
  bot: Telegraf<BotContext>,
  users: UsersRepository,
  downloads: DownloadsRepository,
  adminIds: Set<string>,
  broadcasts: BroadcastManager,
  cache: CacheRepository,
  settings: SettingsRepository,
  downloadQueue: DownloadQueue
): void {
  const isAdmin = (ctx: BotContext) => Boolean(ctx.from && adminIds.has(String(ctx.from.id)));

  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx)) return;
    broadcasts.cancel(String(ctx.from.id));
    await ctx.reply("عملیات جاری ادمین لغو شد.", adminMenu());
  });

  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply("<b>پنل مدیریت ربات</b>", { parse_mode: "HTML", ...adminMenu() });
  });

  bot.action("adm:home", async (ctx) => {
    if (!isAdmin(ctx)) return;
    broadcasts.cancel(String(ctx.from.id));
    await ctx.answerCbQuery();
    await ctx.editMessageText("<b>پنل مدیریت ربات</b>", { parse_mode: "HTML", ...adminMenu() });
  });

  // 1. Detailed System Statistics
  bot.action("adm:stats", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();

    const stats = users.globalStats();
    const newUsersToday = users.countNewUsersToday();
    const langStats = users.countByLanguage();
    const cacheStats = cache.stats();
    const ytDlpStatus = getYtDlpStatus();
    const tikWmUsage = tikWmCircuit.getUsageCount();
    const gramStats = gramjsMonitor.getStats();
    const perfSummary = metricsManager.getSummary();

    // Memory (RAM) calculation
    const ramRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const ramPct = Math.min(100, Math.round((ramRssMb / 256) * 100));

    // Disk calculation
    const usedDiskMb = await getAccountUsedMb();
    const maxBudgetMb = config.maxDiskBudgetMb || 1000;
    const diskPct = Math.min(100, Math.round((usedDiskMb / maxBudgetMb) * 100));

    const text = [
      "<b>📊 آمار و وضعیت سیستم</b>",
      "",
      `<b>⚡ منابع سرور (VPS 256MB):</b>`,
      `▸ رم مصرفی: <code>${renderProgressBar(ramPct)} (${ramRssMb}MB / 256MB)</code>`,
      `▸ دیسک مصرفی: <code>${renderProgressBar(diskPct)} (${usedDiskMb}MB / ${maxBudgetMb}MB)</code>`,
      `▸ صف دانلود: <code>${downloadQueue.waitingCount} در انتظار │ ${downloadQueue.activeCountNumber} فعال</code>`,
      "",
      `<b>👥 کاربران و دانلودها:</b>`,
      `▸ کل کاربران: <code>${stats.totalUsers}</code> (امروز: <code>${newUsersToday}</code>)`,
      `▸ تفکیک زبان: 🇮🇷 <code>${langStats.fa}</code> │ 🇬🇧 <code>${langStats.en}</code> │ تعیین‌نشده: <code>${langStats.unset}</code>`,
      `▸ کل دانلودها: <code>${stats.totalDownloads}</code> (امروز: <code>${stats.downloadsToday}</code>)`,
      `▸ موفق: <code>${stats.successfulDownloads}</code> │ ناموفق: <code>${stats.failedDownloads}</code>`,
      "",
      `<b>📦 ابزارها و کش:</b>`,
      `▸ مدیاهای کش‌شده: <code>${cacheStats.totalCount}</code> (حجم: <code>${formatBytes(cacheStats.totalSavedBytes)}</code>)`,
      `▸ نسخه yt-dlp: <code>${ytDlpStatus.version}</code> (آپدیت: <code>${ytDlpStatus.lastUpdated}</code>)`,
      `▸ دانلودهای تیک‌تاک (TikWM): <code>${tikWmUsage}</code> بار`,
      "",
      `<b>🚀 آپلودر GramJS (MTProto):</b>`,
      `▸ خطاهای FLOOD_WAIT (۲۴ ساعت): <code>${gramStats.floodWaitCount24h}</code>`,
      `▸ بیشترین توقف: <code>${gramStats.maxWaitSeconds} ثانیه</code>`,
      `▸ آخرین وضعیت: <code>${escapeHtml(gramStats.lastUploadError)}</code>`,
      "",
      `<b>📈 سرعت و عملکرد شبکه:</b>`,
      `▸ میانه سرعت: <code>${perfSummary.medianSpeedMBs.toFixed(2)} MB/s</code> (صدک ۹۵: <code>${perfSummary.p95SpeedMBs.toFixed(2)} MB/s</code>)`,
      `▸ میانه زمان تحویل: <code>${perfSummary.medianDurationSec}s</code>`
    ].join("\n");

    await ctx.editMessageText(text, { parse_mode: "HTML", ...backToAdmin() });
  });

  // 2. Cache Management
  bot.action("adm:cache", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const stats = cache.stats();
    const text = [
      "<b>مدیریت کش دانلودها ⚡</b>",
      `<blockquote>▸ تعداد رسانه‌های کش‌شده: <code>${stats.totalCount}</code></blockquote>`,
      `<blockquote>▸ حجم کل صرفه‌جویی‌شده: <code>${formatBytes(stats.totalSavedBytes)}</code></blockquote>`
    ].join("\n");

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("✕ پاک‌سازی کل کش", "adm:cache_clear")],
      [Markup.button.callback("بازگشت", "adm:home")]
    ]);

    await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
  });

  bot.action("adm:cache_clear", async (ctx) => {
    if (!isAdmin(ctx)) return;
    cache.clear();
    await ctx.answerCbQuery("کش با موفقیت پاک شد.");
    await ctx.editMessageText("<b>کش با موفقیت پاک شد.</b>", { parse_mode: "HTML", ...backToAdmin() });
  });

  // 3. Force Join Settings
  bot.action("adm:forcejoin", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const isEnabled = settings.isForceJoinEnabled();
    const channel = settings.getForceJoinChannel() || "تنظیم‌نشده";

    const text = [
      "<b>📢 تنظیمات عضویت اجباری (Force Join)</b>",
      `<blockquote>▸ وضعیت: <b>${isEnabled ? "فعال ✅" : "غیرفعال ❌"}</b></blockquote>`,
      `<blockquote>▸ کانال هدف: <code>${escapeHtml(channel)}</code></blockquote>`,
      "",
      "برای تغییر کانال، دستور زیر را ارسال کنید:",
      "<code>/setchannel @YourChannel</code>"
    ].join("\n");

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(isEnabled ? "🔴 غیرفعال‌سازی" : "🟢 فعال‌سازی", "adm:fj_toggle")],
      [Markup.button.callback("بازگشت", "adm:home")]
    ]);

    await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
  });

  bot.action("adm:fj_toggle", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const current = settings.isForceJoinEnabled();
    settings.setForceJoinEnabled(!current);
    await ctx.answerCbQuery(`جوین اجباری ${!current ? "فعال" : "غیرفعال"} شد.`);
    // Re-render
    const isEnabled = !current;
    const channel = settings.getForceJoinChannel() || "تنظیم‌نشده";
    const text = [
      "<b>📢 تنظیمات عضویت اجباری (Force Join)</b>",
      `<blockquote>▸ وضعیت: <b>${isEnabled ? "فعال ✅" : "غیرفعال ❌"}</b></blockquote>`,
      `<blockquote>▸ کانال هدف: <code>${escapeHtml(channel)}</code></blockquote>`,
      "",
      "برای تغییر کانال، دستور زیر را ارسال کنید:",
      "<code>/setchannel @YourChannel</code>"
    ].join("\n");

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(isEnabled ? "🔴 غیرفعال‌سازی" : "🟢 فعال‌سازی", "adm:fj_toggle")],
      [Markup.button.callback("بازگشت", "adm:home")]
    ]);

    await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
  });

  bot.command("setchannel", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const arg = ctx.message.text.split(/\s+/)[1]?.trim();
    if (!arg) {
      await ctx.reply("لطفاً آیدی کانال را وارد کنید. مثال:\n<code>/setchannel @mychannel</code>", { parse_mode: "HTML" });
      return;
    }
    settings.setForceJoinChannel(arg);
    await ctx.reply(`کانال جوین اجباری با موفقیت روی <code>${escapeHtml(arg)}</code> تنظیم شد.`, { parse_mode: "HTML", ...backToAdmin() });
  });

  // 4. Last 20 Log Lines (Sanitized)
  bot.action("adm:logs", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();

    let logText = "فایل لاگ یافت نشد.";
    const logPaths = [
      "/home/hermemssss/mimo/bot.log",
      "bot.log"
    ];

    for (const p of logPaths) {
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, "utf-8");
          const lines = content.trim().split("\n").slice(-20);
          logText = lines.join("\n");
          break;
        } catch {}
      }
    }

    const sanitized = sanitizeLog(logText, config.botToken);
    const text = [
      "<b>📜 ۲۰ خط آخر لاگ سیستم (سانسور شده):</b>",
      `<pre><code>${escapeHtml(sanitized.slice(-3500))}</code></pre>`
    ].join("\n");

    await ctx.editMessageText(text, { parse_mode: "HTML", ...backToAdmin() });
  });

  // 5. Banned Users List & Ban/Unban
  bot.action("adm:banned", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const banned = users.listBanned(10);

    if (banned.length === 0) {
      await ctx.editMessageText("<b>هیچ کاربری مسدود نیست.</b>", { parse_mode: "HTML", ...backToAdmin() });
      return;
    }

    const rows = banned.map(
      (u) => `• <b>${displayName(u)}</b> (<code>${u.telegramId}</code>)`
    );

    const buttons = banned.map((u) => [
      Markup.button.callback(`رفع مسدودیت ${displayName(u)}`, `adm:ban:${u.id}:0:0`)
    ]);
    buttons.push([Markup.button.callback("بازگشت", "adm:home")]);

    const text = [
      "<b>🚫 لیست کاربران مسدودشده (۱۰ نفر اخیر):</b>",
      rows.join("\n"),
      "",
      "برای مسدود یا آن‌بن کردن دستی دستورات زیر را بفرستید:",
      "<code>/ban 123456789</code> یا <code>/unban 123456789</code>"
    ].join("\n");

    await ctx.editMessageText(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.command("ban", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const tgId = ctx.message.text.split(/\s+/)[1]?.trim();
    if (!tgId) return void (await ctx.reply("شناسه تلگرام را وارد کنید: <code>/ban 12345678</code>", { parse_mode: "HTML" }));
    users.banByTelegramId(tgId, true);
    await ctx.reply(`کاربر با آیدی <code>${tgId}</code> مسدود شد.`, { parse_mode: "HTML" });
  });

  bot.command("unban", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const tgId = ctx.message.text.split(/\s+/)[1]?.trim();
    if (!tgId) return void (await ctx.reply("شناسه تلگرام را وارد کنید: <code>/unban 12345678</code>", { parse_mode: "HTML" }));
    users.banByTelegramId(tgId, false);
    await ctx.reply(`کاربر با آیدی <code>${tgId}</code> رفع مسدودیت شد.`, { parse_mode: "HTML" });
  });

  // Custom Emoji Management Command for Admin
  bot.command("setemoji", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(/\s+/);
    const platform = parts[1]?.toLowerCase().trim();

    const validPlatforms = ["youtube", "instagram", "tiktok", "spotify", "soundcloud", "x", "twitter"];

    if (!platform || !validPlatforms.includes(platform)) {
      const currentList = ["youtube", "instagram", "tiktok", "spotify", "soundcloud", "x"]
        .map((p) => {
          const id = settings.getPlatformEmojiId(p);
          const icon = settings.getPlatformEmojiHtml(p);
          return `• <b>${p}</b>: ${icon} ${id ? `(ID: <code>${id}</code>)` : "(پیش‌فرض)"}`;
        })
        .join("\n");

      await ctx.reply(
        `<b>تنظیم Custom Emoji پلتفرم‌ها:</b>\n\n` +
          `روش استفاده:\n` +
          `<code>/setemoji &lt;platform&gt; &lt;ایموجی سفارشی یا ID&gt;</code>\n\n` +
          `پلتفرم‌های معتبر:\n<code>youtube, instagram, tiktok, spotify, soundcloud, x</code>\n\n` +
          `<b>وضعیت فعلی:</b>\n${currentList}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    let customEmojiId: string | undefined;
    const entities = ctx.message.entities || [];
    const customEmojiEntity = entities.find((e: any) => e.type === "custom_emoji" && (e as any).custom_emoji_id);

    if (customEmojiEntity && (customEmojiEntity as any).custom_emoji_id) {
      customEmojiId = (customEmojiEntity as any).custom_emoji_id;
    } else if (parts[2] && /^\d+$/.test(parts[2].trim())) {
      customEmojiId = parts[2].trim();
    }

    if (!customEmojiId) {
      await ctx.reply(
        `✕ لطفاً یک ایموجی پریمیوم سفارشی (Custom Emoji) یا آیدی عددی آن را همراه با دستور ارسال کنید:\n` +
          `مثال: <code>/setemoji ${platform} &lt;emoji&gt;</code> یا <code>/setemoji ${platform} 5368324170671202286</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const normPlatform = platform === "twitter" ? "x" : platform;
    settings.setPlatformEmojiId(normPlatform, customEmojiId);

    const rendered = settings.getPlatformEmojiHtml(normPlatform);
    await ctx.reply(
      `✓ ایموجی پلتفرم <b>${normPlatform}</b> با موفقیت تنظیم شد:\n` +
        `نمایش: ${rendered}\nشناسه: <code>${customEmojiId}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // 6. User List & Pagination
  bot.action(/^adm:users:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const page = Number(ctx.match[1]);
    const total = users.count();
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pageCount - 1);
    const rows = users.list(safePage, PAGE_SIZE);
    const buttons = rows.map((user) => [
      Markup.button.callback(`${user.isBanned ? "[مسدود] " : ""}${displayName(user)} (${user.totalDownloads})`, `adm:user:${user.id}:0`)
    ]);
    const nav = [];
    if (safePage > 0) nav.push(Markup.button.callback("قبلی", `adm:users:${safePage - 1}`));
    if (safePage + 1 < pageCount) nav.push(Markup.button.callback("بعدی", `adm:users:${safePage + 1}`));
    if (nav.length) buttons.push(nav);
    buttons.push([Markup.button.callback("بازگشت", "adm:home")]);
    await ctx.editMessageText(`<b>لیست کاربران</b> (صفحه ${safePage + 1} از ${pageCount}):`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons)
    });
  });

  bot.action(/^adm:user:(\d+):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const user = users.findById(userId);
    if (!user) return void (await ctx.editMessageText("کاربر یافت نشد.", backToAdmin()));
    const stats = users.statsFor(userId);
    const historyCount = downloads.countForUser(userId);
    const pages = Math.max(1, Math.ceil(historyCount / HISTORY_SIZE));
    const safePage = Math.min(page, pages - 1);
    const history = downloads.listForUser(userId, safePage, HISTORY_SIZE);
    const historyText = history.length
      ? history.map((item) => `${item.status === "success" ? "✓" : "✕"} │ ${formatDate(item.createdAt)}\n<code>${escapeHtml(item.url)}</code>`).join("\n\n")
      : "بدون دانلود.";
    const text = [
      `<b>${displayName(user)}</b> (<code>${user.telegramId}</code>)`,
      `<blockquote>عضویت: ${formatDate(user.firstSeen)}</blockquote>`,
      `<blockquote>آخرین فعالیت: ${formatDate(stats.lastActive)}</blockquote>`,
      `<blockquote>دانلودها: کل <code>${stats.totalDownloads}</code> │ امروز <code>${stats.downloadsToday}</code></blockquote>`,
      `<blockquote>وضعیت: <b>${user.isBanned ? "مسدود" : "فعال"}</b></blockquote>`,
      `تاریخچه دانلود (صفحه ${safePage + 1} از ${pages}):`,
      historyText
    ].join("\n");
    const nav = [];
    if (safePage > 0) nav.push(Markup.button.callback("قبلی", `adm:user:${userId}:${safePage - 1}`));
    if (safePage + 1 < pages) nav.push(Markup.button.callback("بعدی", `adm:user:${userId}:${safePage + 1}`));
    const buttons = [
      [Markup.button.callback(user.isBanned ? "رفع مسدودیت" : "مسدود کردن", `adm:ban:${userId}:${user.isBanned ? 0 : 1}:${safePage}`)],
      ...(nav.length ? [nav] : []),
      [Markup.button.callback("کاربران", "adm:users:0")]
    ];
    await ctx.editMessageText(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^adm:ban:(\d+):([01]):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const ban = Number(ctx.match[2]) === 1;
    const page = Number(ctx.match[3]);
    users.setBanned(userId, ban);
    const user = users.findById(userId);
    if (!user) return void (await ctx.editMessageText("کاربر یافت نشد.", backToAdmin()));
    await ctx.editMessageText(`کاربر ${displayName(user)} ${ban ? "مسدود شد" : "رفع مسدودیت شد"}.`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("مشاهده کاربر", `adm:user:${userId}:${page}`)],
        [Markup.button.callback("کاربران", "adm:users:0")]
      ])
    });
  });

  bot.action("adm:broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🌐 همه کاربران (All)", "adm:bc_target:all")],
      [Markup.button.callback("🇮🇷 فقط فارسی (Persian)", "adm:bc_target:fa")],
      [Markup.button.callback("🇬🇧 فقط انگلیسی (English)", "adm:bc_target:en")],
      [Markup.button.callback("بازگشت", "adm:home")]
    ]);
    await ctx.editMessageText(
      "<b>ارسال پیام همگانی</b>\nجامعه هدف پیام را انتخاب کنید:",
      { parse_mode: "HTML", ...keyboard }
    );
  });

  bot.action(/^adm:bc_target:(all|fa|en)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const target = ctx.match[1] as "all" | "fa" | "en";
    const label =
      target === "fa" ? "فقط فارسی" : target === "en" ? "فقط انگلیسی" : "همه کاربران";

    try {
      broadcasts.begin(String(ctx.from.id), target);
      await ctx.editMessageText(
        `پیامی که می‌خواهید به <b>${label}</b> ارسال شود را بفرستید.\nبرای انصراف /cancel بزنید.`,
        { parse_mode: "HTML", ...backToAdmin() }
      );
    } catch (err: any) {
      await ctx.editMessageText(err?.message || "خطا در شروع ارسال همگانی.", backToAdmin());
    }
  });

  bot.action("adm:cancel_bc", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery("درخواست لغو ارسال همگانی ثبت شد.");
    broadcasts.requestCancel();
  });
}
