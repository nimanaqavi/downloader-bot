package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mimo/internal/utils"
)

var (
	ErrSpotifyUnsupported = errors.New("unsupported_type")
	ErrSpotifyNotFound    = errors.New("track_not_found")
)

type SpotifyTrackInfo struct {
	Title           string
	Artist          string
	DurationSeconds float64
	ThumbnailURL    string
}

type SearchCandidate struct {
	ID       string
	Title    string
	Duration float64
	Uploader string
	URL      string
	Provider string
}

func ParseSpotifyURL(rawURL string) (cleanURL string, linkType string, err error) {
	rawURL = strings.TrimSpace(rawURL)

	// Resolve spotify.link short link redirects
	if strings.Contains(rawURL, "spotify.link") {
		client := &http.Client{
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
			Timeout: 6 * time.Second,
		}
		resp, err := client.Head(rawURL)
		if err == nil && resp.StatusCode >= 300 && resp.StatusCode < 400 {
			loc := resp.Header.Get("Location")
			if loc != "" {
				safe, _ := utils.ValidateSafeURL(loc)
				if safe {
					rawURL = loc
				}
			}
		}
	}

	cleanURL = utils.NormalizeMediaURL(rawURL)
	u, err := url.Parse(cleanURL)
	if err != nil {
		return cleanURL, "unknown", err
	}

	path := strings.ToLower(u.Path)
	switch {
	case strings.Contains(path, "/track/"):
		return cleanURL, "track", nil
	case strings.Contains(path, "/album/"):
		return cleanURL, "album", nil
	case strings.Contains(path, "/playlist/"):
		return cleanURL, "playlist", nil
	case strings.Contains(path, "/episode/") || strings.Contains(path, "/show/"):
		return cleanURL, "podcast", nil
	default:
		return cleanURL, "unknown", nil
	}
}

func FetchSpotifyMetadata(ctx context.Context, normalizedURL string) (*SpotifyTrackInfo, error) {
	// Strategy A: oEmbed API with retry
	oembedURL := fmt.Sprintf("https://open.spotify.com/oembed?url=%s", url.QueryEscape(normalizedURL))

	for attempt := 1; attempt <= 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "GET", oembedURL, nil)
		if err == nil {
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
			client := &http.Client{Timeout: 6 * time.Second}
			resp, err := client.Do(req)
			if err == nil {
				if resp.StatusCode == 200 {
					var data struct {
						Title        string `json:"title"`
						AuthorName   string `json:"author_name"`
						ThumbnailURL string `json:"thumbnail_url"`
					}
					if err := json.NewDecoder(resp.Body).Decode(&data); err == nil && data.Title != "" {
						resp.Body.Close()
						return &SpotifyTrackInfo{
							Title:        strings.TrimSpace(data.Title),
							Artist:       strings.TrimSpace(data.AuthorName),
							ThumbnailURL: data.ThumbnailURL,
						}, nil
					}
				}
				resp.Body.Close()
			}
		}
		time.Sleep(time.Duration(attempt*300) * time.Millisecond)
	}

	// Strategy B: Fallback HTML scraping
	req, err := http.NewRequestWithContext(ctx, "GET", normalizedURL, nil)
	if err == nil {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		client := &http.Client{Timeout: 7 * time.Second}
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			defer resp.Body.Close()
			buf := make([]byte, 64*1024)
			n, _ := resp.Body.Read(buf)
			html := string(buf[:n])

			ogTitleReg := regexp.MustCompile(`(?i)<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']`)
			ogDescReg := regexp.MustCompile(`(?i)<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']`)

			tMatch := ogTitleReg.FindStringSubmatch(html)
			if len(tMatch) > 1 {
				title := strings.TrimSpace(tMatch[1])
				artist := ""
				dMatch := ogDescReg.FindStringSubmatch(html)
				if len(dMatch) > 1 {
					parts := strings.Split(dMatch[1], "·")
					if len(parts) > 1 {
						artist = strings.TrimSpace(parts[1])
					}
				}
				return &SpotifyTrackInfo{
					Title:  title,
					Artist: artist,
				}, nil
			}
		}
	}

	return nil, errors.New("failed to retrieve spotify track metadata")
}

func selectBestCandidate(candidates []SearchCandidate, trackTitle, artist string, targetDuration float64) *SearchCandidate {
	if len(candidates) == 0 {
		return nil
	}
	lowerTitle := strings.ToLower(trackTitle)
	allowsLiveOrRemix := strings.Contains(lowerTitle, "remix") || strings.Contains(lowerTitle, "live") || strings.Contains(lowerTitle, "cover")

	var pool []SearchCandidate
	for _, c := range candidates {
		if allowsLiveOrRemix {
			pool = append(pool, c)
			continue
		}
		cLower := strings.ToLower(c.Title)
		if strings.Contains(cLower, "live") || strings.Contains(cLower, "remix") || strings.Contains(cLower, "cover") ||
			strings.Contains(cLower, "karaoke") || strings.Contains(cLower, "instrumental") {
			continue
		}
		pool = append(pool, c)
	}

	if len(pool) == 0 {
		pool = candidates
	}

	if targetDuration > 0 {
		var best *SearchCandidate
		minDiff := 9999.0
		for i := range pool {
			c := &pool[i]
			if c.Duration > 0 {
				diff := math.Abs(c.Duration - targetDuration)
				if diff < minDiff {
					minDiff = diff
					best = c
				}
			}
		}
		if best != nil && minDiff <= 45 {
			return best
		}
	}

	return &pool[0]
}

func (d *Downloader) SearchTrackOnProviders(
	ctx context.Context,
	trackTitle, artist string,
	targetDuration float64,
) (*SearchCandidate, error) {
	query := trackTitle
	if artist != "" {
		query = fmt.Sprintf("%s - %s", artist, trackTitle)
	}

	// 1. YouTube Search (ytsearch3:)
	ytArgs := []string{
		"--force-ipv4",
		"--no-warnings",
		"--no-js-runtimes",
		"--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(webpage_url)s",
		fmt.Sprintf("ytsearch3:%s", query),
	}

	cmd := exec.CommandContext(ctx, d.getYtDlpBin(), ytArgs...)
	out, err := cmd.Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		var ytCandidates []SearchCandidate
		for _, line := range lines {
			parts := strings.Split(line, "\t")
			if len(parts) >= 5 {
				dur, _ := strconv.ParseFloat(parts[2], 64)
				ytCandidates = append(ytCandidates, SearchCandidate{
					ID:       parts[0],
					Title:    parts[1],
					Duration: dur,
					Uploader: parts[3],
					URL:      parts[4],
					Provider: "youtube",
				})
			}
		}
		best := selectBestCandidate(ytCandidates, trackTitle, artist, targetDuration)
		if best != nil {
			return best, nil
		}
	}

	// 2. SoundCloud Fallback (scsearch3:)
	scArgs := []string{
		"--force-ipv4",
		"--no-warnings",
		"--no-js-runtimes",
		"--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(webpage_url)s",
		fmt.Sprintf("scsearch3:%s", query),
	}
	cmdSc := exec.CommandContext(ctx, d.getYtDlpBin(), scArgs...)
	outSc, errSc := cmdSc.Output()
	if errSc == nil {
		lines := strings.Split(strings.TrimSpace(string(outSc)), "\n")
		var scCandidates []SearchCandidate
		for _, line := range lines {
			parts := strings.Split(line, "\t")
			if len(parts) >= 5 {
				dur, _ := strconv.ParseFloat(parts[2], 64)
				scCandidates = append(scCandidates, SearchCandidate{
					ID:       parts[0],
					Title:    parts[1],
					Duration: dur,
					Uploader: parts[3],
					URL:      parts[4],
					Provider: "soundcloud",
				})
			}
		}
		best := selectBestCandidate(scCandidates, trackTitle, artist, targetDuration)
		if best != nil {
			return best, nil
		}
	}

	return nil, ErrSpotifyNotFound
}

func (d *Downloader) ResolveAndDownloadSpotify(ctx context.Context, mediaURL string) (*DownloadResult, error) {
	cleanURL, linkType, err := ParseSpotifyURL(mediaURL)
	if err != nil || linkType != "track" {
		return nil, ErrSpotifyUnsupported
	}

	meta, err := FetchSpotifyMetadata(ctx, cleanURL)
	if err != nil {
		return nil, err
	}

	candidate, err := d.SearchTrackOnProviders(ctx, meta.Title, meta.Artist, meta.DurationSeconds)
	if err != nil {
		return nil, err
	}

	res, err := d.Download(ctx, candidate.URL, QualityAudio, nil)
	if err != nil {
		return nil, err
	}

	res.Title = meta.Title
	res.Author = meta.Artist
	res.PlatformName = "Spotify"
	if meta.DurationSeconds > 0 {
		res.DurationSeconds = meta.DurationSeconds
	}

	return res, nil
}
