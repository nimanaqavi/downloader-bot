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
)

type InstagramMediaItem struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"` // "photo" or "video" or "audio"
	URL      string  `json:"url"`
	AudioURL string  `json:"audio_url,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	Title    string  `json:"title,omitempty"`
	Author   string  `json:"author,omitempty"`
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
		homePath := filepath.Join(os.Getenv("HOME"), "mimo", "scripts", "instagramExtractor.py")
		if _, err2 := os.Stat(homePath); err2 == nil {
			scriptPath = homePath
		} else if _, err3 := os.Stat("/home/telbot/mimo/scripts/instagramExtractor.py"); err3 == nil {
			scriptPath = "/home/telbot/mimo/scripts/instagramExtractor.py"
		} else {
			return nil, fmt.Errorf("instagramExtractor.py not found")
		}
	}

	args := []string{scriptPath, mediaURL}
	if d.cfg.CookiesPath != "" {
		if _, err := os.Stat(d.cfg.CookiesPath); err == nil {
			args = append(args, d.cfg.CookiesPath)
		}
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	// Instagram throttles the shared datacenter IP in bursts, so the exact same
	// link fails once and then works on resend. Retry inside the request instead
	// of making the user send it again.
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt*2) * time.Second):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}

		cmd := exec.CommandContext(timeoutCtx, "python3", args...)
		out, err := cmd.Output()
		if err != nil {
			lastErr = fmt.Errorf("python extractor failed: %w", err)
			continue
		}

		var post InstagramPostInfo
		if err := json.Unmarshal(out, &post); err != nil {
			lastErr = fmt.Errorf("parse instagram json: %w", err)
			continue
		}
		if post.Error != "" {
			lastErr = fmt.Errorf("instagram error: %s", post.Error)
			continue
		}
		for i := range post.Items {
			if post.Items[i].Title == "" {
				post.Items[i].Title = post.Title
			}
			if post.Items[i].Author == "" {
				post.Items[i].Author = post.Channel
			}
		}
		return &post, nil
	}

	return nil, lastErr
}

func (d *Downloader) DownloadInstagramItem(ctx context.Context, item InstagramMediaItem, onProgress ProgressCallback) (*DownloadResult, error) {
	tmpDir, err := os.MkdirTemp(d.cfg.TempDir, "mimo-ig-")
	if err != nil {
		return nil, err
	}

	ext := "mp4"
	mediaType := "video"
	switch item.Type {
	case "photo":
		ext, mediaType = "jpg", "photo"
	case "audio":
		ext, mediaType = "m4a", "audio"
	}
	outPath := filepath.Join(tmpDir, fmt.Sprintf("instagram_%s.%s", item.ID, ext))

	client := &http.Client{Timeout: 45 * time.Second}
	downloadFile := func(targetURL, targetPath string, trackProgress bool) (int64, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
		if err != nil {
			return 0, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		resp, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return 0, fmt.Errorf("instagram CDN HTTP %d", resp.StatusCode)
		}
		f, err := os.Create(targetPath)
		if err != nil {
			return 0, err
		}
		defer f.Close()

		var r io.Reader = resp.Body
		if trackProgress && onProgress != nil && resp.ContentLength > 0 {
			r = &progressReader{reader: resp.Body, total: resp.ContentLength, onProgress: onProgress, lastPct: -1}
		}
		return io.Copy(f, r)
	}

	var written int64
	if mediaType == "video" && item.AudioURL != "" {
		// ponytail: DASH video + audio stream merge with ffmpeg -c copy
		videoTmp := filepath.Join(tmpDir, "video_stream.mp4")
		audioTmp := filepath.Join(tmpDir, "audio_stream.m4a")

		vSize, err := downloadFile(item.URL, videoTmp, true)
		if err != nil {
			os.RemoveAll(tmpDir)
			return nil, fmt.Errorf("download video stream: %w", err)
		}
		aSize, err := downloadFile(item.AudioURL, audioTmp, false)
		if err != nil {
			_ = os.Rename(videoTmp, outPath)
			written = vSize
		} else {
			ffmpegBin := "ffmpeg"
			if d.getFfmpegDir() != "" {
				ffmpegBin = filepath.Join(d.getFfmpegDir(), "ffmpeg")
			}
			mergeCmd := exec.CommandContext(ctx, ffmpegBin, "-y", "-i", videoTmp, "-i", audioTmp, "-c", "copy", "-movflags", "+faststart", outPath)
			if err := mergeCmd.Run(); err != nil {
				_ = os.Rename(videoTmp, outPath)
				written = vSize
			} else {
				if fi, err := os.Stat(outPath); err == nil {
					written = fi.Size()
				} else {
					written = vSize + aSize
				}
				_ = os.Remove(videoTmp)
				_ = os.Remove(audioTmp)
			}
		}
	} else {
		w, err := downloadFile(item.URL, outPath, true)
		if err != nil {
			os.RemoveAll(tmpDir)
			return nil, err
		}
		written = w
	}

	width, height, dur := 0, 0, item.Duration
	if mediaType == "video" {
		w, h, d2, _ := d.EnsureFaststartAndProbe(outPath)
		width, height = w, h
		if d2 > 0 {
			dur = d2
		}
	}

	title := item.Title
	if title == "" {
		title = "Instagram"
	}

	return &DownloadResult{
		MediaPath:       outPath,
		VideoPath:       outPath,
		MediaType:       mediaType,
		FileSizeBytes:   written,
		Title:           title,
		DurationSeconds: dur,
		Width:           width,
		Height:          height,
		PlatformName:    "Instagram",
		Author:          item.Author,
		TempDirectory:   tmpDir,
	}, nil
}
