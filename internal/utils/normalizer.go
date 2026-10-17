package utils

import (
	"net/url"
	"regexp"
	"strings"
)

var trackingParams = map[string]bool{
	"igsh":     true,
	"si":       true,
	"feature":  true,
	"fbclid":   true,
	"ref":      true,
	"source":   true,
	"app":      true,
	"t":        true,
	"tracking": true,
}

func NormalizeMediaURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	// Lowercase host and protocol
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)

	// Clean query parameters
	q := u.Query()
	for k := range q {
		lowerK := strings.ToLower(k)
		if strings.HasPrefix(lowerK, "utm_") || trackingParams[lowerK] {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()

	// Clean trailing slash from path if path is longer than 1 char
	if len(u.Path) > 1 && strings.HasSuffix(u.Path, "/") {
		u.Path = strings.TrimRight(u.Path, "/")
	}

	return u.String()
}

type ParsedMediaURL struct {
	URL              string
	Platform         string
	PlatformName     string
	IsAudioRequested bool
}

var urlRegex = regexp.MustCompile(`(?i)https?://[^\s]+`)

func ExtractURLFromText(text string) (string, bool) {
	text = strings.TrimSpace(text)
	isAudio := false
	if strings.HasPrefix(strings.ToLower(text), "mp3 ") {
		isAudio = true
		text = strings.TrimSpace(text[4:])
	}
	match := urlRegex.FindString(text)
	if match == "" {
		return "", false
	}
	return match, isAudio
}

func ParseMediaURL(rawURL string) *ParsedMediaURL {
	clean := strings.TrimSpace(rawURL)
	isAudio := false
	if strings.HasPrefix(strings.ToLower(clean), "mp3 ") {
		isAudio = true
		clean = strings.TrimSpace(clean[4:])
	}

	u, err := url.Parse(clean)
	if err != nil {
		return nil
	}

	host := strings.ToLower(u.Hostname())
	if host == "" {
		return nil
	}

	var platform, platformName string
	switch {
	case strings.Contains(host, "instagram.com"):
		platform = "instagram"
		platformName = "Instagram"
	case strings.Contains(host, "youtube.com") || strings.Contains(host, "youtu.be"):
		platform = "youtube"
		platformName = "YouTube"
	case strings.Contains(host, "tiktok.com"):
		platform = "tiktok"
		platformName = "TikTok"
	case strings.Contains(host, "spotify.com") || strings.Contains(host, "spotify.link"):
		platform = "spotify"
		platformName = "Spotify"
	case strings.Contains(host, "soundcloud.com"):
		platform = "soundcloud"
		platformName = "SoundCloud"
	case strings.Contains(host, "twitter.com") || strings.Contains(host, "x.com"):
		platform = "x"
		platformName = "X"
	default:
		platform = "generic"
		platformName = "Web"
	}

	return &ParsedMediaURL{
		URL:              clean,
		Platform:         platform,
		PlatformName:     platformName,
		IsAudioRequested: isAudio,
	}
}
