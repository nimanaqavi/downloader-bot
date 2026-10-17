package bot

import (
	tele "gopkg.in/telebot.v3"

	"mimo/internal/database"
	"mimo/internal/i18n"
)

func HistoryKeyboard(lang string) *tele.ReplyMarkup {
	menu := &tele.ReplyMarkup{}
	d := i18n.Get(lang)

	btnIG := menu.Data(d.HistBtnInstagram, "hist:instagram")
	btnYT := menu.Data(d.HistBtnYouTube, "hist:youtube")
	btnTT := menu.Data(d.HistBtnTikTok, "hist:tiktok")
	btnAll := menu.Data(d.HistBtnAll, "hist:all")

	menu.Inline(
		menu.Row(btnIG, btnYT),
		menu.Row(btnTT, btnAll),
	)
	return menu
}

func RegisterHistoryHandlers(
	b *tele.Bot,
	db *database.DB,
) {
	b.Handle("/history", func(c tele.Context) error {
		sender := c.Sender()
		if sender == nil {
			return nil
		}
		lang := db.GetUserLanguage(sender.ID)
		return c.Send(i18n.Get(lang).HistoryTitle, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: HistoryKeyboard(lang),
		})
	})
}
