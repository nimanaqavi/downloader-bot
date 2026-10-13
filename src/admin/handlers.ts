import { Markup, type Telegraf } from "telegraf";
import type { DownloadsRepository } from "../database/repositories/downloads.js";
import type { UsersRepository } from "../database/repositories/users.js";
import type { BotContext, User } from "../types/index.js";
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
  broadcasts: BroadcastManager
): void {
  const isAdmin = (ctx: BotContext) => Boolean(ctx.from && adminIds.has(String(ctx.from.id)));

  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx)) return;
    broadcasts.cancel(String(ctx.from.id));
    await ctx.reply("Current admin action cancelled.", adminMenu());
  });

  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply("Admin panel", adminMenu());
  });

  bot.action("adm:home", async (ctx) => {
    if (!isAdmin(ctx)) return;
    broadcasts.cancel(String(ctx.from.id));
    await ctx.answerCbQuery();
    await ctx.editMessageText("Admin panel", adminMenu());
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
      Markup.button.callback(`${user.isBanned ? "[BANNED] " : ""}${displayName(user)} (${user.totalDownloads})`, `adm:user:${user.id}:0`)
    ]);
    const navigation = [];
    if (safePage > 0) navigation.push(Markup.button.callback("Previous", `adm:users:${safePage - 1}`));
    if (safePage + 1 < pageCount) navigation.push(Markup.button.callback("Next", `adm:users:${safePage + 1}`));
    if (navigation.length) buttons.push(navigation);
    buttons.push([Markup.button.callback("Back", "adm:home")]);
    await ctx.editMessageText(`Users (${total}) - page ${safePage + 1}/${pageCount}`, Markup.inlineKeyboard(buttons));
  });

  bot.action(/^adm:user:(\d+):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const userId = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const user = users.findById(userId);
    if (!user) return void (await ctx.editMessageText("User no longer exists.", backToAdmin()));
    const stats = users.statsFor(userId);
    const historyCount = downloads.countForUser(userId);
    const pages = Math.max(1, Math.ceil(historyCount / HISTORY_SIZE));
    const safePage = Math.min(page, pages - 1);
    const history = downloads.listForUser(userId, safePage, HISTORY_SIZE);
    const historyText = history.length
      ? history.map((item) => `${item.status === "success" ? "OK" : "FAILED"} | ${formatDate(item.createdAt)}\n${item.url}`).join("\n\n")
      : "No downloads.";
    const text = [
      `${displayName(user)} (${user.telegramId})`,
      `Joined: ${formatDate(user.firstSeen)}`,
      `Last active: ${formatDate(stats.lastActive)}`,
      `Downloads: ${stats.totalDownloads} total, ${stats.downloadsToday} today, ${stats.downloadsThisWeek} this week`,
      `Status: ${user.isBanned ? "banned" : "active"}`,
      `History page ${safePage + 1}/${pages}:`,
      historyText
    ].join("\n");
    const nav = [];
    if (safePage > 0) nav.push(Markup.button.callback("Previous", `adm:user:${userId}:${safePage - 1}`));
    if (safePage + 1 < pages) nav.push(Markup.button.callback("Next", `adm:user:${userId}:${safePage + 1}`));
    const buttons = [
      [Markup.button.callback(user.isBanned ? "Unban" : "Ban", `adm:ban:${userId}:${user.isBanned ? 0 : 1}:${safePage}`)],
      ...(nav.length ? [nav] : []),
      [Markup.button.callback("Users", "adm:users:0")]
    ];
    await ctx.editMessageText(text.slice(0, 4000), Markup.inlineKeyboard(buttons));
  });

  bot.action(/^adm:ban:(\d+):([01]):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const userId = Number(ctx.match[1]);
    users.setBanned(userId, ctx.match[2] === "1");
    await ctx.answerCbQuery(ctx.match[2] === "1" ? "User banned" : "User unbanned");
    const user = users.findById(userId)!;
    const stats = users.statsFor(userId);
    await ctx.editMessageText(
      `${displayName(user)} (${user.telegramId})\nStatus: ${user.isBanned ? "banned" : "active"}\nDownloads: ${stats.totalDownloads}\nLast active: ${formatDate(stats.lastActive)}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(user.isBanned ? "Unban" : "Ban", `adm:ban:${userId}:${user.isBanned ? 0 : 1}:0`)],
        [Markup.button.callback("View history", `adm:user:${userId}:0`), Markup.button.callback("Users", "adm:users:0")]
      ])
    );
  });

  bot.action("adm:stats", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const stats = users.globalStats();
    const successRate = stats.totalDownloads ? ((stats.successfulDownloads / stats.totalDownloads) * 100).toFixed(1) : "0.0";
    const leaderboard = users.leaderboard().map((user, index) => `${index + 1}. ${displayName(user)} - ${user.totalDownloads}`).join("\n") || "No downloads yet.";
    await ctx.editMessageText(
      `Global statistics\n\nUsers: ${stats.totalUsers}\nDownloads: ${stats.totalDownloads}\nToday: ${stats.downloadsToday}\nSuccessful: ${stats.successfulDownloads}\nFailed: ${stats.failedDownloads}\nSuccess rate: ${successRate}%\n\nMost active users\n${leaderboard}`,
      backToAdmin()
    );
  });

  bot.action("adm:broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return;
    broadcasts.begin(String(ctx.from.id));
    await ctx.answerCbQuery();
    await ctx.editMessageText("Send the text, photo, or video to broadcast. Use /cancel to stop.", backToAdmin());
  });
}
