import { Markup } from "telegraf";

export const adminMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("▸ کاربران", "adm:users:0"), Markup.button.callback("▸ آمار ربات", "adm:stats")],
    [Markup.button.callback("▸ کش دانلود ⚡", "adm:cache"), Markup.button.callback("▸ ارسال همگانی", "adm:broadcast")]
  ]);

export const backToAdmin = () => Markup.inlineKeyboard([[Markup.button.callback("بازگشت", "adm:home")]]);
