package bot

import (
	tele "gopkg.in/telebot.v3"

	"mimo/internal/config"
	"mimo/internal/database"
	"mimo/internal/i18n"
)

func BuildLanguageKeyboard(userLangCode string) *tele.ReplyMarkup {
	menu := &tele.ReplyMarkup{}
	isEnglishFirst := userLangCode != "" && userLangCode[:2] != "fa"

	btnFA := menu.Data(i18n.Get("fa").BtnFA, "set_lang:fa")
	btnEN := menu.Data(i18n.Get("en").BtnEN, "set_lang:en")

	if isEnglishFirst {
		menu.Inline(menu.Row(btnEN, btnFA))
	} else {
		menu.Inline(menu.Row(btnFA, btnEN))
	}
	return menu
}

func RegisterStartHandlers(
	b *tele.Bot,
	cfg *config.Config,
	db *database.DB,
) {
	b.Handle("/start", func(c tele.Context) error {
		sender := c.Sender()
		if sender == nil {
			return nil
		}

		if db.IsUserLanguageSet(sender.ID) {
			lang := db.GetUserLanguage(sender.ID)
			return c.Send(i18n.Get(lang).Start, &tele.SendOptions{
				ParseMode: tele.ModeHTML,
				ReplyMarkup: &tele.ReplyMarkup{
					RemoveKeyboard: true,
				},
			})
		}

		userLangCode := sender.LanguageCode
		return c.Send(i18n.Get("fa").ChooseLanguage, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BuildLanguageKeyboard(userLangCode),
		})
	})

	b.Handle("/help", func(c tele.Context) error {
		sender := c.Sender()
		if sender == nil {
			return nil
		}
		lang := db.GetUserLanguage(sender.ID)
		botUsername := cfg.BotUsername
		return c.Send(i18n.Get(lang).Help(botUsername), &tele.SendOptions{
			ParseMode: tele.ModeHTML,
			ReplyMarkup: &tele.ReplyMarkup{
				RemoveKeyboard: true,
			},
		})
	})

	b.Handle("/language", func(c tele.Context) error {
		sender := c.Sender()
		if sender == nil {
			return nil
		}
		return c.Send(i18n.Get("fa").ChooseLanguage, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BuildLanguageKeyboard(sender.LanguageCode),
		})
	})
}
