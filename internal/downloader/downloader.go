package downloader

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
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
	Quality4K      VideoQuality = "4k"
	Quality1080p   VideoQuality = "1080p"
	Quality720p    VideoQuality = "720p"
	Quality480p    VideoQuality = "480p"
	Quality360p    VideoQuality = "360p"
	QualityCompact VideoQuality = "compact"
	QualityAudio   VideoQuality = "audio"
)

type ErrQualityNotAvailable struct {
	Requested string
	Available []string
}

func (e *ErrQualityNotAvailable) Error() string {
	return fmt.Sprintf("quality %s not available (available: %s)", e.Requested, strings.Join(e.Available, ", "))
}

func (e *ErrQualityNotAvailable) GetRequestedAndAvailable() (string, []string) {
	return e.Requested, e.Available
}

type Metadata struct {
	Title              string
	Duration           float64
	Uploader           string
	Author             string
	ThumbnailURL       string
	FilesizeApprox     int64
	InfoJSONPath       string
	AvailableQualities []string
}

type DownloadResult struct {
	MediaPath       string
	VideoPath       string
	MediaType       string // "video", "audio", "photo"
	FileSizeBytes   int64
	Title           string
	DurationSeconds float64
	Width           int
	Height          int
	ThumbnailPath   string
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

	tmpDir, err := os.MkdirTemp(d.cfg.TempDir, "mimo-meta-")
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
		args = append(args, "--extractor-args", "youtube:player_client=visionos")
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
	if len(matches) == 0 && isYouTube {
		// Fallback: retry metadata extraction with android client
		retryArgs := make([]string, len(args))
		copy(retryArgs, args)
		for i, a := range retryArgs {
			if a == "youtube:player_client=visionos" {
				retryArgs[i] = "youtube:player_client=android"
			}
		}
		_ = exec.CommandContext(fetchCtx, d.getYtDlpBin(), retryArgs...).Run()
		matches, _ = filepath.Glob(filepath.Join(tmpDir, "*.info.json"))
	}
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

	// Extract available video resolutions
	if formats, ok := raw["formats"].([]any); ok {
		meta.AvailableQualities = qualitiesFromFormats(formats)
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

// runYtDlp executes yt-dlp, forwarding download percentages to onProgress and
// returning a wrapped error carrying the last few output lines on failure.
func (d *Downloader) runYtDlp(ctx context.Context, args []string, onProgress ProgressCallback) error {
	cmd := exec.CommandContext(ctx, d.getYtDlpBin(), args...)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("create stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start yt-dlp: %w", err)
	}

	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Split(scanLinesOrCR)

	var lastLines []string
	for scanner.Scan() {
		line := scanner.Text()
		if len(lastLines) > 5 {
			lastLines = lastLines[1:]
		}
		lastLines = append(lastLines, line)

		if onProgress == nil || !strings.Contains(line, "[download]") {
			continue
		}
		if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
			if f, err := strconv.ParseFloat(matches[1], 64); err == nil {
				onProgress(int(f))
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("yt-dlp download failed: %s (%w)", strings.Join(lastLines, " | "), err)
	}
	return nil
}

var formatUnavailableRegex = regexp.MustCompile(`Requested format is not available`)

// probeAvailableQualities asks yt-dlp which resolutions this video actually
// offers right now. It is only called on the failure path, so the extra
// process costs nothing in the normal case.
func (d *Downloader) probeAvailableQualities(ctx context.Context, mediaURL, client string) []string {
	args := []string{
		"--force-ipv4", "--no-warnings", "--no-cache-dir", "--no-js-runtimes",
		"--skip-download", "--dump-single-json",
	}
	if client != "" {
		args = append(args, "--extractor-args", "youtube:player_client="+client)
	}
	args = append(args, mediaURL)

	probeCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	out, err := exec.CommandContext(probeCtx, d.getYtDlpBin(), args...).Output()
	if err != nil {
		return nil
	}

	var raw map[string]any
	if json.Unmarshal(out, &raw) != nil {
		return nil
	}

	formats, _ := raw["formats"].([]any)
	return qualitiesFromFormats(formats)
}

// qualitiesFromFormats maps yt-dlp format entries to the standard quality
// names, using the smaller side of each resolution so vertical videos
// (e.g. 1080x1920 Shorts) report their real tier instead of being missed.
func qualitiesFromFormats(formats []any) []string {
	seen := make(map[string]bool)
	for _, fAny := range formats {
		fMap, ok := fAny.(map[string]any)
		if !ok {
			continue
		}
		vcodec, _ := fMap["vcodec"].(string)
		if vcodec == "" || vcodec == "none" {
			continue
		}
		w, _ := fMap["width"].(float64)
		h, _ := fMap["height"].(float64)
		if w <= 0 && h <= 0 {
			continue
		}
		dim := h
		if w > 0 && h > 0 && w < h {
			dim = w
		} else if dim <= 0 {
			dim = w
		}
		switch {
		case dim >= 2160:
			seen["4k"] = true
		case dim >= 1080:
			seen["1080p"] = true
		case dim >= 720:
			seen["720p"] = true
		case dim >= 480:
			seen["480p"] = true
		case dim >= 360:
			seen["360p"] = true
		}
	}

	var qualities []string
	for _, q := range []string{"4k", "1080p", "720p", "480p", "360p"} {
		if seen[q] {
			qualities = append(qualities, q)
		}
	}
	return qualities
}

func (d *Downloader) Download(
	ctx context.Context,
	mediaURL string,
	quality VideoQuality,
	onProgress ProgressCallback,
) (*DownloadResult, error) {
	// Disk safety check against the account quota (1 GB on Alwaysdata).
	// Measured fresh each time so cleanup of temp files is reflected at once.
	if !utils.CheckDiskBudget(os.Getenv("HOME"), 100*1024*1024, d.cfg.MaxDiskBudgetMB, d.cfg.DiskSafetyMarginBytes) {
		return nil, fmt.Errorf("فضای خالی سرور برای دانلود جدید کافی نیست")
	}

	tmpDir, err := os.MkdirTemp(d.cfg.TempDir, "mimo-dl-")
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
		case Quality4K:
			formatString = "bestvideo[height=2160][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height=2160][vcodec^=vp9]+bestaudio/bestvideo[height=2160]+bestaudio/bestvideo[width=2160]+bestaudio"
		case Quality1080p:
			formatString = "bestvideo[height=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height=1080][vcodec^=vp9]+bestaudio/bestvideo[height=1080]+bestaudio/bestvideo[width=1080]+bestaudio"
		case Quality720p:
			formatString = "bestvideo[height=720][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height=720]+bestaudio/bestvideo[width=720]+bestaudio/best[height=720]"
		case Quality480p:
			formatString = "bestvideo[height=480][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height=480]+bestaudio/bestvideo[width=480]+bestaudio/best[height=480]"
		case Quality360p:
			formatString = "bestvideo[height=360][vcodec^=avc1]+bestaudio[ext=m4a]/best[height=360]/bestvideo[height=360]+bestaudio"
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
		"--newline",
		"--progress",
		"--buffer-size", "1M",
		"--concurrent-fragments", "8",
		"--retries", "3",
		"--fragment-retries", "3",
		"--format", formatString,
		"--output", outTemplate,
		"--postprocessor-args", "ffmpeg:-threads 2 -movflags +faststart",
	}

	if ffDir := d.getFfmpegDir(); ffDir != "" {
		args = append(args, "--ffmpeg-location", ffDir)
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

	// YouTube's signed media URLs are rejected with 403 or bot-checked when the shared
	// Alwaysdata IP trips its heuristics. Retrying across proven clients resolves the issue.
	clientAttempts := []string{""}
	if isYouTube {
		clientAttempts = []string{
			"visionos",
			"android,visionos",
			"tv_embedded",
		}
	}

	var lastErr error
	for attempt, client := range clientAttempts {
		if attempt > 0 {
			// Clear all partial files from previous attempt
			entries, _ := os.ReadDir(tmpDir)
			for _, e := range entries {
				_ = os.Remove(filepath.Join(tmpDir, e.Name()))
			}
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		runArgs := make([]string, 0, len(args)+2)
		runArgs = append(runArgs, args...)
		if isYouTube && client != "" {
			runArgs = append(runArgs, "--extractor-args", "youtube:player_client="+client)
		}

		// No per-attempt deadline: a legit 1080p/4K transfer here runs past 90 s and
		// killing it mid-download would burn the bandwidth and fail every retry.
		// dlCtx (DownloadTimeoutSec) already bounds the whole sequence.
		err := d.runYtDlp(dlCtx, runArgs, onProgress)

		if err != nil {
			lastErr = err

			isFormatUnavailable := formatUnavailableRegex.MatchString(err.Error())
			isBlockedOr403 := strings.Contains(err.Error(), "403") ||
				strings.Contains(err.Error(), "Forbidden") ||
				strings.Contains(err.Error(), "Sign in to confirm you") ||
				strings.Contains(err.Error(), "Too Many Requests") ||
				strings.Contains(err.Error(), "The page needs to be reloaded")

			if isYouTube && (isFormatUnavailable || isBlockedOr403) && attempt+1 < len(clientAttempts) {
				log.Printf("[youtube] client %q failed (%v), trying next client (attempt %d/%d)",
					client, err, attempt+1, len(clientAttempts))
				continue
			}

			// Only return ErrQualityNotAvailable when the format is genuinely unavailable
			// AND not due to a block/403/bot-check.
			if isYouTube && isFormatUnavailable && !isBlockedOr403 {
				avail := d.probeAvailableQualities(ctx, mediaURL, "visionos")
				if len(avail) > 0 {
					_ = os.RemoveAll(tmpDir)
					return nil, &ErrQualityNotAvailable{Requested: string(quality), Available: avail}
				}
			}

			os.RemoveAll(tmpDir)
			return nil, err
		}
		lastErr = nil
		break
	}

	if lastErr != nil {
		os.RemoveAll(tmpDir)
		return nil, lastErr
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

	var width, height int
	if mediaType == "video" {
		w, h, dur, _ := d.EnsureFaststartAndProbe(chosenFile)
		if w > 0 && h > 0 {
			width = w
			height = h
		}
		if dur > 0 && duration == 0 {
			duration = dur
		}
	}

	return &DownloadResult{
		MediaPath:       chosenFile,
		VideoPath:       chosenFile,
		MediaType:       mediaType,
		FileSizeBytes:   chosenSize,
		Title:           title,
		DurationSeconds: duration,
		Width:           width,
		Height:          height,
		PlatformName:    platformName,
		Author:          author,
		TempDirectory:   tmpDir,
	}, nil
}

func scanLinesOrCR(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i := 0; i < len(data); i++ {
		if data[i] == '\n' || data[i] == '\r' {
			return i + 1, data[:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func (d *Downloader) EnsureFaststartAndProbe(videoPath string) (int, int, float64, error) {
	if _, err := os.Stat(videoPath); err != nil {
		return 0, 0, 0, err
	}

	ffDir := d.getFfmpegDir()
	ffmpegBin := "ffmpeg"
	ffprobeBin := "ffprobe"
	if ffDir != "" {
		if _, err := os.Stat(filepath.Join(ffDir, "ffmpeg")); err == nil {
			ffmpegBin = filepath.Join(ffDir, "ffmpeg")
		}
		if _, err := os.Stat(filepath.Join(ffDir, "ffprobe")); err == nil {
			ffprobeBin = filepath.Join(ffDir, "ffprobe")
		}
	}

	// 1. If MP4, ensure moov atom is at the beginning (skip if already faststart)
	if strings.HasSuffix(strings.ToLower(videoPath), ".mp4") && !hasFaststartAtom(videoPath) {
		fastPath := videoPath + ".fast.mp4"
		cmd := exec.Command(ffmpegBin, "-y", "-loglevel", "error", "-i", videoPath, "-c", "copy", "-movflags", "+faststart", "-threads", "1", fastPath)
		if err := cmd.Run(); err == nil {
			if fi, err := os.Stat(fastPath); err == nil && fi.Size() > 0 {
				_ = os.Rename(fastPath, videoPath)
			} else {
				_ = os.Remove(fastPath)
			}
		}
	}

	// 2. Probe width, height, duration with ffprobe
	cmdProbe := exec.Command(ffprobeBin, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "default=noprint_wrappers=1", videoPath)
	out, err := cmdProbe.Output()
	if err != nil {
		return 0, 0, 0, nil
	}

	var width, height int
	var duration float64

	lines := strings.Split(string(out), "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "width=") {
			width, _ = strconv.Atoi(strings.TrimPrefix(l, "width="))
		} else if strings.HasPrefix(l, "height=") {
			height, _ = strconv.Atoi(strings.TrimPrefix(l, "height="))
		} else if strings.HasPrefix(l, "duration=") {
			duration, _ = strconv.ParseFloat(strings.TrimPrefix(l, "duration="), 64)
		}
	}

	return width, height, duration, nil
}

// hasFaststartAtom reports whether the moov atom precedes mdat in the MP4 file.
// It walks top-level box headers, so it is O(number of top-level boxes) and
// avoids remuxing files yt-dlp already produced with faststart enabled.
func hasFaststartAtom(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	var offset int64
	header := make([]byte, 8)

	for {
		if _, err := f.ReadAt(header, offset); err != nil {
			return false
		}
		size := int64(header[0])<<24 | int64(header[1])<<16 | int64(header[2])<<8 | int64(header[3])
		boxType := string(header[4:8])

		if boxType == "moov" {
			return true
		}
		if boxType == "mdat" {
			return false
		}

		if size == 1 {
			// 64-bit extended size
			ext := make([]byte, 8)
			if _, err := f.ReadAt(ext, offset+8); err != nil {
				return false
			}
			size = 0
			for i := 0; i < 8; i++ {
				size = size<<8 | int64(ext[i])
			}
		}
		if size <= 0 {
			return false
		}
		offset += size
	}
}
