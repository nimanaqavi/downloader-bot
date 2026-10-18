package utils

import (
	"fmt"
	"html"
	"math"
	"strings"

	"mimo/internal/i18n"
)

func EscapeHTML(str string) string {
	return html.EscapeString(str)
}

func FormatDuration(seconds float64) string {
	if seconds <= 0 || math.IsNaN(seconds) {
		return "--:--"
	}
	sec := int(math.Floor(seconds))
	h := sec / 3600
	m := (sec % 3600) / 60
	s := sec % 60
	if h > 0 {
		return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%02d:%02d", m, s)
}

func FormatBytes(bytes int64, lang string) string {
	if bytes <= 0 {
		return ""
	}
	mb := float64(bytes) / (1024 * 1024)
	if mb < 1 {
		kb := int(math.Round(float64(bytes) / 1024))
		if lang == "en" {
			return fmt.Sprintf("%d KB", kb)
		}
		return fmt.Sprintf("%d کیلوبایت", kb)
	}
	if mb >= 1000 {
		gb := mb / 1024
		if lang == "en" {
			return fmt.Sprintf("%.1f GB", gb)
		}
		return fmt.Sprintf("%.1f گیگابایت", gb)
	}
	roundedMb := math.Round(mb*10) / 10
	if lang == "en" {
		return fmt.Sprintf("%.1f MB", roundedMb)
	}
	return fmt.Sprintf("%.1f مگابایت", roundedMb)
}

func RenderProgressBar(percentage int) string {
	clamped := percentage
	if clamped < 0 {
		clamped = 0
	} else if clamped > 100 {
		clamped = 100
	}
	filledCount := clamped / 10
	emptyCount := 10 - filledCount
	bar := strings.Repeat("▰", filledCount) + strings.Repeat("▱", emptyCount)
	return fmt.Sprintf("[%s] %d%%", bar, clamped)
}

func TruncateText(text string, maxLength int) string {
	if len([]rune(text)) <= maxLength {
		return text
	}
	runes := []rune(text)
	return string(runes[:maxLength-1]) + "…"
}

func RenderPlatformEmojiHTML(platform, customEmojiID string) string {
	if customEmojiID != "" {
		return fmt.Sprintf(`<tg-emoji emoji-id="%s">%s</tg-emoji>`, customEmojiID, GetDefaultEmoji(platform))
	}
	return GetDefaultEmoji(platform)
}

func GetDefaultEmoji(platform string) string {
	switch strings.ToLower(platform) {
	case "youtube":
		return "▶️"
	case "instagram":
		return "📸"
	case "tiktok":
		return "🎶"
	case "spotify":
		return "🟢"
	case "soundcloud":
		return "☁️"
	case "x", "twitter":
		return "🐦"
	default:
		return "🌐"
	}
}

type QualityCardOpts struct {
	Platform          string
	PlatformName      string
	PlatformEmojiHTML string
	Title             string
	DurationSeconds   float64
	ThumbnailURL      string
	Lang              string
}

func BuildQualityCardText(opts QualityCardOpts) string {
	isYt := opts.Platform == "youtube"
	durationLabel := "مدت"
	if opts.Lang == "en" {
		durationLabel = "Duration"
	}
	durationPart := ""
	if opts.DurationSeconds > 0 {
		durationPart = fmt.Sprintf(" │ ⏱ %s: <code>%s</code>", durationLabel, FormatDuration(opts.DurationSeconds))
	}

	var thumbPrefix string
	if opts.ThumbnailURL != "" && (strings.HasPrefix(opts.ThumbnailURL, "http://") || strings.HasPrefix(opts.ThumbnailURL, "https://")) {
		thumbPrefix = fmt.Sprintf("<a href=\"%s\">&#8205;</a>", EscapeHTML(opts.ThumbnailURL))
	}

	if isYt {
		return fmt.Sprintf("%s<blockquote>%s YouTube%s</blockquote>", thumbPrefix, opts.PlatformEmojiHTML, durationPart)
	}

	titleIsolated := i18n.Isolate(EscapeHTML(TruncateText(opts.Title, 80)))
	return fmt.Sprintf("%s<b>%s</b>\n<blockquote>%s %s%s</blockquote>",
		thumbPrefix,
		titleIsolated,
		opts.PlatformEmojiHTML,
		opts.PlatformName,
		durationPart,
	)
}

type FinalCaptionOpts struct {
	Title           string
	Author          string
	DurationSeconds float64
	FileSizeBytes   int64
	PlatformName    string
	PlatformEmoji   string
	CustomEmojiID   string
	BotUsername     string
	IsAudio         bool
	Lang            string
}

func BuildFinalCaption(opts FinalCaptionOpts) string {
	lang := opts.Lang
	if lang == "" {
		lang = "fa"
	}
	icon := "🎬"
	if opts.IsAudio {
		icon = "🎵"
	}

	isolatedTitle := i18n.Isolate(EscapeHTML(TruncateText(opts.Title, 80)))
	titleLine := fmt.Sprintf("%s <b>%s</b>", icon, isolatedTitle)

	var authorLine string
	if opts.Author != "" {
		isolatedAuthor := i18n.Isolate(EscapeHTML(TruncateText(opts.Author, 60)))
		if opts.IsAudio {
			if lang == "en" {
				authorLine = fmt.Sprintf("👤 Artist: %s\n", isolatedAuthor)
			} else {
				authorLine = fmt.Sprintf("👤 خواننده: %s\n", isolatedAuthor)
			}
		} else {
			authorLine = fmt.Sprintf("👤 <i>%s</i>\n", isolatedAuthor)
		}
	}

	durationLabel := "مدت"
	sizeLabel := "حجم"
	if lang == "en" {
		durationLabel = "Duration"
		sizeLabel = "Size"
	}

	durationPart := ""
	if opts.DurationSeconds > 0 {
		durationPart = fmt.Sprintf("⏱ %s: <code>%s</code> │ ", durationLabel, FormatDuration(opts.DurationSeconds))
	}
	sizePart := fmt.Sprintf("💾 %s: <code>%s</code>", sizeLabel, FormatBytes(opts.FileSizeBytes, lang))

	emoji := opts.PlatformEmoji
	if emoji == "" {
		emoji = RenderPlatformEmojiHTML(opts.PlatformName, opts.CustomEmojiID)
	}

	statsBlock := fmt.Sprintf("<blockquote>%s%s\n%s %s</blockquote>", durationPart, sizePart, emoji, opts.PlatformName)
	botLine := fmt.Sprintf("🤖 @%s", opts.BotUsername)

	var lines []string
	lines = append(lines, titleLine)
	if authorLine != "" {
		lines = append(lines, strings.TrimRight(authorLine, "\n"))
	}
	lines = append(lines, statsBlock, botLine)
	caption := strings.Join(lines, "\n")

	if len(caption) > 1024 {
		overflow := len(caption) - 1024
		maxTitleLen := 80 - overflow
		if maxTitleLen < 20 {
			maxTitleLen = 20
		}
		shorterTitle := TruncateText(opts.Title, maxTitleLen)
		lines[0] = fmt.Sprintf("%s <b>%s</b>", icon, i18n.Isolate(EscapeHTML(shorterTitle)))
		caption = strings.Join(lines, "\n")
	}

	return caption
}
