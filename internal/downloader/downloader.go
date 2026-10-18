package downloader

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"mimo/internal/config"
	"mimo/internal/utils"
)

type VideoQuality string

const (
	Quality720p   VideoQuality = "720p"
	Quality480p   VideoQuality = "480p"
	Quality360p   VideoQuality = "360p"
	QualityCompact VideoQuality = "compact"
	QualityAudio   VideoQuality = "audio"
)

type Metadata struct {
	Title          string
	Duration       float64
	Uploader       string
	Author         string
	ThumbnailURL   string
	FilesizeApprox int64
	InfoJSONPath   string
}

type DownloadResult struct {
	MediaPath       string
	VideoPath       string
	MediaType       string // "video", "audio", "photo"
	FileSizeBytes   int64
	Title           string
	DurationSeconds float64
	PlatformName    string
	Author          string
	TempDirectory   string
}

type Downloader struct {
	cfg            *config.Config
	metaCacheMu    sync.RWMutex
	metaCacheFiles map[string]metaCacheEntry
}

type metaCacheEntry struct {
	path      string
	meta      Metadata
	createdAt time.Time
}

func New(cfg *config.Config) *Downloader {
	d := &Downloader{
		cfg:            cfg,
		metaCacheFiles: make(map[string]metaCacheEntry),
	}
	go d.cleanupOldCacheLoop()
	return d
}

func (d *Downloader) cleanupOldCacheLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		d.metaCacheMu.Lock()
		now := time.Now()
		for k, entry := range d.metaCacheFiles {
			if now.Sub(entry.createdAt) > 10*time.Minute {
				os.Remove(entry.path)
				delete(d.metaCacheFiles, k)
			}
		}
		d.metaCacheMu.Unlock()
	}
}

func (d *Downloader) getYtDlpBin() string {
	home := os.Getenv("HOME")
	if home != "" {
		custom := filepath.Join(home, "bin", "yt-dlp")
		if _, err := os.Stat(custom); err == nil {
			return custom
		}
	}
	return "yt-dlp"
}

func (d *Downloader) getFfmpegDir() string {
	home := os.Getenv("HOME")
	if home != "" {
		custom := filepath.Join(home, "bin")
		if _, err := os.Stat(filepath.Join(custom, "ffmpeg")); err == nil {
			return custom
		}
	}
	if _, err := os.Stat("/home/telbot/bin/ffmpeg"); err == nil {
		return "/home/telbot/bin"
	}
	return ""
}

func (d *Downloader) FetchMetadata(ctx context.Context, mediaURL string) (*Metadata, error) {
	h := sha256.Sum256([]byte(mediaURL))
	hashKey := hex.EncodeToString(h[:8])

	d.metaCacheMu.RLock()
	if entry, ok := d.metaCacheFiles[hashKey]; ok && time.Since(entry.createdAt) < 10*time.Minute {
		d.metaCacheMu.RUnlock()
		return &entry.meta, nil
	}
	d.metaCacheMu.RUnlock()

	tmpDir, err := os.MkdirTemp("", "mimo-meta-")
	if err != nil {
		return nil, fmt.Errorf("create temp meta dir: %w", err)
	}

	parsed := utils.ParseMediaURL(mediaURL)
	isYouTube := parsed != nil && parsed.Platform == "youtube"
	isInstagram := parsed != nil && parsed.Platform == "instagram"

	args := []string{
		"--force-ipv4",
		"--no-warnings",
		"--no-cache-dir",
		"--no-js-runtimes",
		"--skip-download",
		"--write-info-json",
		"--output", filepath.Join(tmpDir, "info"),
	}

	if ffDir := d.getFfmpegDir(); ffDir != "" {
		args = append(args, "--ffmpeg-location", ffDir)
	}

	if isYouTube {
		args = append(args, "--extractor-args", "youtube:player_client=android,visionos")
	}

	// Cookies policy: NEVER pass cookies to YouTube (causes bot challenge/format skip)
	// Pass cookies for Instagram and other platforms
	if isInstagram && d.cfg.CookiesPath != "" {
		if _, err := os.Stat(d.cfg.CookiesPath); err == nil {
			args = append(args, "--cookies", d.cfg.CookiesPath)
		}
	} else if !isYouTube && d.cfg.CookiesPath != "" {
		if _, err := os.Stat(d.cfg.CookiesPath); err == nil {
			args = append(args, "--cookies", d.cfg.CookiesPath)
		}
	}

	args = append(args, mediaURL)

	fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(fetchCtx, d.getYtDlpBin(), args...)
	_ = cmd.Run()

	// Find the created .info.json
	matches, _ := filepath.Glob(filepath.Join(tmpDir, "*.info.json"))
	if len(matches) == 0 {
		os.RemoveAll(tmpDir)

		fallbackThumb := ""
		if isYouTube {
			if u, err := url.Parse(mediaURL); err == nil {
				vid := u.Query().Get("v")
				if vid == "" && strings.Contains(u.Host, "youtu.be") {
					vid = strings.TrimPrefix(u.Path, "/")
				}
				if vid != "" {
					fallbackThumb = fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", vid)
				}
			}
		}

		return &Metadata{
			Title:        "Media",
			Duration:     0,
			ThumbnailURL: fallbackThumb,
			InfoJSONPath: "",
		}, nil
	}

	realJSONPath := matches[0]
	data, err := os.ReadFile(realJSONPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("read info json: %w", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("parse info json: %w", err)
	}

	meta := Metadata{
		InfoJSONPath: realJSONPath,
	}

	if t, ok := raw["title"].(string); ok {
		meta.Title = t
	}
	if u, ok := raw["uploader"].(string); ok {
		meta.Uploader = u
	}
	if a, ok := raw["channel"].(string); ok {
		meta.Author = a
	}
	if meta.Author == "" {
		meta.Author = meta.Uploader
	}
	if dur, ok := raw["duration"].(float64); ok {
		meta.Duration = dur
	}
	if fs, ok := raw["filesize_approx"].(float64); ok {
		meta.FilesizeApprox = int64(fs)
	}

	// Thumbnail resolution
	if isYouTube {
		if rawID, ok := raw["id"].(string); ok && len(rawID) == 11 {
			meta.ThumbnailURL = fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", rawID)
		}
	}
	if meta.ThumbnailURL == "" {
		if thumb, ok := raw["thumbnail"].(string); ok {
			meta.ThumbnailURL = thumb
		}
	}
	if isYouTube && meta.ThumbnailURL == "" {
		if u, err := url.Parse(mediaURL); err == nil {
			vid := u.Query().Get("v")
			if vid == "" && strings.Contains(u.Host, "youtu.be") {
				vid = strings.TrimPrefix(u.Path, "/")
			}
			if vid != "" {
				meta.ThumbnailURL = fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", vid)
			}
		}
	}

	d.metaCacheMu.Lock()
	d.metaCacheFiles[hashKey] = metaCacheEntry{
		path:      realJSONPath,
		meta:      meta,
		createdAt: time.Now(),
	}
	d.metaCacheMu.Unlock()

	return &meta, nil
}

type ProgressCallback func(percentage int)

var progressRegex = regexp.MustCompile(`\[download\]\s+(\d+(?:\.\d+)?)%`)

func (d *Downloader) Download(
	ctx context.Context,
	mediaURL string,
	quality VideoQuality,
	onProgress ProgressCallback,
) (*DownloadResult, error) {
	// Disk safety check
	home := os.Getenv("HOME")
	if !utils.CheckDiskBudget(home, 100*1024*1024, d.cfg.MaxDiskBudgetMB, d.cfg.DiskSafetyMarginBytes) {
		return nil, fmt.Errorf("فضای خالی سرور برای دانلود جدید کافی نیست")
	}

	tmpDir, err := os.MkdirTemp("", "mimo-dl-")
	if err != nil {
		return nil, fmt.Errorf("create temp download dir: %w", err)
	}

	outTemplate := filepath.Join(tmpDir, "%(id)s.%(ext)s")

	parsed := utils.ParseMediaURL(mediaURL)
	isYouTube := parsed != nil && parsed.Platform == "youtube"
	isTikTok := parsed != nil && parsed.Platform == "tiktok"
	isInstagram := parsed != nil && parsed.Platform == "instagram"

	var formatString string
	isAudio := quality == QualityAudio

	if isTikTok {
		if isAudio {
			formatString = "bestaudio/best"
		} else {
			formatString = "best[ext=mp4]/best"
		}
	} else if isYouTube {
		switch quality {
		case Quality720p:
			formatString = "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
		case Quality480p:
			formatString = "bestvideo[height<=480]+bestaudio/best[height<=480]/best"
		case Quality360p:
			formatString = "bestvideo[height<=360]+bestaudio/best[height<=360]/best"
		case QualityAudio:
			formatString = "bestaudio/best"
		default:
			formatString = "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
		}
	} else {
		switch quality {
		case Quality720p:
			formatString = "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
		case Quality480p:
			formatString = "bestvideo[height<=480]+bestaudio/best[height<=480]/best"
		case Quality360p:
			formatString = "bestvideo[height<=360]+bestaudio/best[height<=360]/best"
		case QualityAudio:
			formatString = "bestaudio/best"
		default:
			formatString = "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
		}
	}

	args := []string{
		"--force-ipv4",
		"--no-warnings",
		"--no-cache-dir",
		"--no-part",
		"--no-js-runtimes",
		"--buffer-size", "16K",
		"--concurrent-fragments", "1",
		"--format", formatString,
		"--output", outTemplate,
		"--postprocessor-args", "ffmpeg:-threads 1",
	}

	if ffDir := d.getFfmpegDir(); ffDir != "" {
		args = append(args, "--ffmpeg-location", ffDir)
	}

	if isYouTube {
		args = append(args, "--extractor-args", "youtube:player_client=android,visionos")
	}

	if isAudio {
		args = append(args, "--extract-audio", "--audio-format", "mp3")
	} else {
		args = append(args, "--merge-output-format", "mp4")
	}

	// Cookies policy:
	// Do NOT pass cookies to YouTube
	// PASS cookies for Instagram
	if isInstagram && d.cfg.CookiesPath != "" {
		if _, err := os.Stat(d.cfg.CookiesPath); err == nil {
			args = append(args, "--cookies", d.cfg.CookiesPath)
		}
	} else if !isYouTube && d.cfg.CookiesPath != "" {
		if _, err := os.Stat(d.cfg.CookiesPath); err == nil {
			args = append(args, "--cookies", d.cfg.CookiesPath)
		}
	}

	// For YouTube, pass mediaURL directly to avoid expired format URLs in info.json
	// For other platforms, check if cached info.json exists
	if !isYouTube {
		h := sha256.Sum256([]byte(mediaURL))
		hashKey := hex.EncodeToString(h[:8])

		d.metaCacheMu.RLock()
		cachedEntry, hasCached := d.metaCacheFiles[hashKey]
		d.metaCacheMu.RUnlock()

		if hasCached && cachedEntry.path != "" {
			if _, err := os.Stat(cachedEntry.path); err == nil {
				args = append(args, "--load-info-json", cachedEntry.path)
			} else {
				args = append(args, mediaURL)
			}
		} else {
			args = append(args, mediaURL)
		}
	} else {
		args = append(args, mediaURL)
	}

	timeout := time.Duration(d.cfg.DownloadTimeoutSec) * time.Second
	dlCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(dlCtx, d.getYtDlpBin(), args...)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("create stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("start yt-dlp: %w", err)
	}

	scanner := bufio.NewScanner(stdoutPipe)
	lastReport := time.Now()
	var lastPct int
	var lastLines []string

	for scanner.Scan() {
		line := scanner.Text()
		if len(lastLines) > 5 {
			lastLines = lastLines[1:]
		}
		lastLines = append(lastLines, line)

		if onProgress != nil && strings.Contains(line, "[download]") {
			matches := progressRegex.FindStringSubmatch(line)
			if len(matches) > 1 {
				if f, err := strconv.ParseFloat(matches[1], 64); err == nil {
					pct := int(f)
					if (pct >= lastPct+10 || time.Since(lastReport) >= 2*time.Second) && pct > lastPct {
						lastPct = pct
						lastReport = time.Now()
						onProgress(pct)
					}
				}
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		os.RemoveAll(tmpDir)
		errDetail := strings.Join(lastLines, " | ")
		return nil, fmt.Errorf("yt-dlp download failed: %s (%w)", errDetail, err)
	}

	// Find the output file in tmpDir
	files, err := os.ReadDir(tmpDir)
	if err != nil || len(files) == 0 {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("no output file produced by yt-dlp")
	}

	var chosenFile string
	var chosenSize int64

	for _, f := range files {
		if f.IsDir() || strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		path := filepath.Join(tmpDir, f.Name())
		info, err := f.Info()
		if err == nil && info.Size() > chosenSize {
			chosenSize = info.Size()
			chosenFile = path
		}
	}

	if chosenFile == "" {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("downloaded file not found in temp dir")
	}

	mediaType := "video"
	if isAudio || strings.HasSuffix(chosenFile, ".mp3") || strings.HasSuffix(chosenFile, ".m4a") {
		mediaType = "audio"
	}

	platformName := "Web"
	if parsed != nil {
		platformName = parsed.PlatformName
	}

	title := "Media"
	author := ""
	var duration float64

	h := sha256.Sum256([]byte(mediaURL))
	hashKey := hex.EncodeToString(h[:8])
	d.metaCacheMu.RLock()
	if cachedEntry, hasCached := d.metaCacheFiles[hashKey]; hasCached {
		title = cachedEntry.meta.Title
		author = cachedEntry.meta.Author
		duration = cachedEntry.meta.Duration
	}
	d.metaCacheMu.RUnlock()

	// Adjust disk usage cache
	utils.AdjustCachedUsedMB(chosenSize / (1024 * 1024))

	return &DownloadResult{
		MediaPath:       chosenFile,
		VideoPath:       chosenFile,
		MediaType:       mediaType,
		FileSizeBytes:   chosenSize,
		Title:           title,
		DurationSeconds: duration,
		PlatformName:    platformName,
		Author:          author,
		TempDirectory:   tmpDir,
	}, nil
}
