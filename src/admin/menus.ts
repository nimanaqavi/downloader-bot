import { Markup } from "telegraf";

export const adminMenu = (stickersEnabled: boolean = true) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("▸ آمار سیستم 📊", "adm:stats"), Markup.button.callback("▸ کاربران 👥", "adm:users:0")],
    [Markup.button.callback("▸ کش دانلود ⚡", "adm:cache"), Markup.button.callback("▸ جوین اجباری 📢", "adm:forcejoin")],
    [
      Markup.button.callback(
        stickersEnabled ? "استیکر پلتفرم: روشن 🏷" : "استیکر پلتفرم: خاموش ⚪",
        "adm:toggle_stickers"
      ),
      Markup.button.callback("▸ آخرین لاگ‌ها 📜", "adm:logs")
    ],
    [Markup.button.callback("▸ کاربران مسدود 🚫", "adm:banned"), Markup.button.callback("▸ ارسال همگانی ✉️", "adm:broadcast")]
  ]);

export const backToAdmin = () => Markup.inlineKeyboard([[Markup.button.callback("بازگشت به پنل", "adm:home")]]);
