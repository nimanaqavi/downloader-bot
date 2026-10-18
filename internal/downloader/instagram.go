package downloader

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"mimo/internal/utils"
)

type InstagramMediaItem struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"` // "photo" or "video"
	URL      string  `json:"url"`
	Duration float64 `json:"duration,omitempty"`
}

type InstagramPostInfo struct {
	Title   string               `json:"title"`
	Channel string               `json:"channel"`
	Items   []InstagramMediaItem `json:"items"`
	Error   string               `json:"error,omitempty"`
}

func (d *Downloader) ExtractInstagramMedia(ctx context.Context, mediaURL string) (*InstagramPostInfo, error) {
	scriptPath := filepath.Join("scripts", "instagramExtractor.py")
	if _, err := os.Stat(scriptPath); err != nil {
		// Try root or relative
		scriptPath = "/home/hermemssss/mimo/scripts/instagramExtractor.py"
		if _, err2 := os.Stat(scriptPath); err2 != nil {
			return nil, fmt.Errorf("instagramExtractor.py not found")
		}
	}

	args := []string{scriptPath, mediaURL}
	if d.cfg.CookiesPath != "" {
		if _, err := os.Stat(d.cfg.CookiesPath); err == nil {
			args = append(args, d.cfg.CookiesPath)
		}
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	cmd := exec.CommandContext(timeoutCtx, "python3", args...)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("python extractor failed: %w", err)
	}

	var post InstagramPostInfo
	if err := json.Unmarshal(out, &post); err != nil {
		return nil, fmt.Errorf("parse instagram json: %w", err)
	}

	if post.Error != "" {
		return nil, fmt.Errorf("instagram error: %s", post.Error)
	}

	return &post, nil
}

func (d *Downloader) DownloadInstagramItem(ctx context.Context, item InstagramMediaItem, onProgress ProgressCallback) (*DownloadResult, error) {
	tmpDir, err := os.MkdirTemp(d.cfg.TempDir, "mimo-ig-")
	if err != nil {
		return nil, err
	}

	ext := "mp4"
	mediaType := "video"
	if item.Type == "photo" {
		ext = "jpg"
		mediaType = "photo"
	}
	outPath := filepath.Join(tmpDir, fmt.Sprintf("instagram_%s.%s", item.ID, ext))

	req, err := http.NewRequestWithContext(ctx, "GET", item.URL, nil)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("instagram CDN HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(outPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	defer f.Close()

	bodyReader := io.Reader(resp.Body)
	if onProgress != nil && resp.ContentLength > 0 {
		bodyReader = &progressReader{
			reader:     resp.Body,
			total:      resp.ContentLength,
			onProgress: onProgress,
			lastPct:    -1,
		}
	}

	written, err := io.Copy(f, bodyReader)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}

	utils.AdjustCachedUsedMB(written / (1024 * 1024))

	width, height, dur := 0, 0, item.Duration
	if mediaType == "video" {
		w, h, d2, _ := d.EnsureFaststartAndProbe(outPath)
		width, height = w, h
		if d2 > 0 {
			dur = d2
		}
	}

	return &DownloadResult{
		MediaPath:       outPath,
		VideoPath:       outPath,
		MediaType:       mediaType,
		FileSizeBytes:   written,
		Title:           "Instagram",
		DurationSeconds: dur,
		Width:           width,
		Height:          height,
		PlatformName:    "Instagram",
		Author:          "",
		TempDirectory:   tmpDir,
	}, nil
}
