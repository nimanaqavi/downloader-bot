import { Markup } from "telegraf";

export const adminMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Users", "adm:users:0"), Markup.button.callback("Statistics", "adm:stats")],
    [Markup.button.callback("Broadcast", "adm:broadcast")]
  ]);

export const backToAdmin = () => Markup.inlineKeyboard([[Markup.button.callback("Back", "adm:home")]]);
