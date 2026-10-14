import type { Telegraf } from "telegraf";
import type { BotContext } from "../types/index.js";

export async function registerBotCommandsAndMenu(
  bot: Telegraf<BotContext>,
  adminIds: Set<string>
): Promise<void> {
  const defaultCommandsEn = [
    { command: "history", description: "Download history" },
    { command: "language", description: "Change language" }
  ];

  const defaultCommandsFa = [
    { command: "history", description: "تاریخچه دانلودها" },
    { command: "language", description: "تغییر زبان" }
  ];

  try {
    // 1. Set global default commands (English)
    await bot.telegram.setMyCommands(defaultCommandsEn);
    console.info("[bot] Global default commands (en) registered successfully");

    // 2. Set Persian commands for users with Persian language_code
    await bot.telegram.setMyCommands(defaultCommandsFa, { language_code: "fa" });
    console.info("[bot] Persian commands (fa) registered successfully");

    // 3. Set chat menu button to 'commands' type explicitly
    // @ts-ignore
    await bot.telegram.setChatMenuButton({ menu_button: { type: "commands" } });
    console.info("[bot] Chat menu button set to 'commands' successfully");

    // 4. Set Descriptions
    await bot.telegram
      .setMyDescription("A fast, multi-platform media downloader bot for Telegram.")
      .catch(() => undefined);
    await bot.telegram
      .setMyDescription("ربات پرسرعت دانلود مدیا از یوتیوب، اینستاگرام، تیک‌تاک و سایر پلتفرم‌ها.", "fa")
      .catch(() => undefined);

    await bot.telegram
      .setMyShortDescription("Download videos, audio, and photos from any link.")
      .catch(() => undefined);
    await bot.telegram
      .setMyShortDescription("دانلود آسان و آنی ویدیو، موزیک و عکس از انواع لینک‌ها.", "fa")
      .catch(() => undefined);

    // 5. Scoped commands for each admin to include /admin (hidden from normal users)
    const adminCommands = [
      ...defaultCommandsFa,
      { command: "admin", description: "پنل مدیریت" }
    ];

    for (const adminId of adminIds) {
      const numericId = Number(adminId);
      if (!isNaN(numericId) && numericId > 0) {
        try {
          await bot.telegram.setMyCommands(adminCommands, {
            scope: { type: "chat", chat_id: numericId }
          });
          console.info(`[bot] Scoped admin commands registered for chat ${adminId}`);
        } catch (err) {
          console.warn(`[bot] Failed to set admin commands for chat ${adminId}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("[bot] Failed to register commands or menu button:", error);
  }
}
