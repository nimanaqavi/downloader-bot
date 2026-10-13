import { Markup, type Telegraf } from "telegraf";
import type { CacheRepository } from "../database/repositories/cache.js";
import type { DownloadsRepository } from "../database/repositories/downloads.js";
import type { UsersRepository } from "../database/repositories/users.js";
import type { BotContext, User } from "../types/index.js";
import { formatBytes } from "../utils/formatting.js";
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
  cache: CacheRepository
): void {
  const isAdmin = (ctx: BotContext) => Boolean(ctx.from && adminIds.has(String(ctx.from.id)));

  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx)) return;
    broadcasts.cancel(String(ctx.from.id));
    await ctx.reply("عملیات ادمین لغو شد.", adminMenu());
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

  bot.action("adm:cache", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const stats = cache.stats();
    const text = [
      "<b>مدیریت کش دانلودها ⚡</b>",
      `<blockquote>▸ تعداد رسانه‌های کش‌شده: <code>${stats.totalCount}</code></blockquote>`,
      `<blockquote>▸ حجم کل در کش: <code>${formatBytes(stats.totalSavedBytes)}</code></blockquote>`
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
      ? history.map((item) => `${item.status === "success" ? "✓" : "✕"} │ ${formatDate(item.createdAt)}\n<code>${item.url}</code>`).join("\n\n")
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

  bot.action("adm:stats", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const stats = users.globalStats();
    const text = [
      "<b>آمار کلی ربات</b>",
      `<blockquote>▸ کل کاربران: <code>${stats.totalUsers}</code></blockquote>`,
      `<blockquote>▸ کل دانلودها: <code>${stats.totalDownloads}</code></blockquote>`,
      `<blockquote>▸ دانلودهای امروز: <code>${stats.downloadsToday}</code></blockquote>`,
      `<blockquote>▸ دانلودهای موفق: <code>${stats.successfulDownloads}</code></blockquote>`,
      `<blockquote>▸ دانلودهای ناموفق: <code>${stats.failedDownloads}</code></blockquote>`
    ].join("\n");
    await ctx.editMessageText(text, { parse_mode: "HTML", ...backToAdmin() });
  });

  bot.action("adm:broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    broadcasts.begin(String(ctx.from.id));
    await ctx.editMessageText(
      "پیامی که می‌خواهید به تمام کاربران ارسال شود را بفرستید.\nبرای انصراف /cancel بزنید.",
      backToAdmin()
    );
  });
}
