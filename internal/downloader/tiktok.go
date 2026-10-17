package downloader

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"mimo/internal/utils"
)

type tikWmResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data *struct {
		ID       string  `json:"id"`
		Title    string  `json:"title"`
		Duration float64 `json:"duration"`
		Size     int64   `json:"size"`
		Play     string  `json:"play"`
		Cover    string  `json:"cover"`
		Author   *struct {
			UniqueID string `json:"unique_id"`
			Nickname string `json:"nickname"`
		} `json:"author"`
	} `json:"data"`
}

type TikWMCircuitBreaker struct {
	mu                  sync.Mutex
	consecutiveFailures int
	disabledUntil       time.Time
	totalUsageCount     int
}

var tikWmCircuit = &TikWMCircuitBreaker{}

func (c *TikWMCircuitBreaker) IsOpen() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return time.Now().Before(c.disabledUntil)
}

func (c *TikWMCircuitBreaker) RecordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.consecutiveFailures = 0
	c.disabledUntil = time.Time{}
	c.totalUsageCount++
}

func (c *TikWMCircuitBreaker) RecordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.consecutiveFailures++
	if c.consecutiveFailures >= 3 {
		c.disabledUntil = time.Now().Add(5 * time.Minute)
	}
}

func (c *TikWMCircuitBreaker) GetUsageCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.totalUsageCount
}

func GetTikWMUsageCount() int {
	return tikWmCircuit.GetUsageCount()
}

func (d *Downloader) DownloadTikTok(
	ctx context.Context,
	mediaURL string,
	onProgress ProgressCallback,
) (*DownloadResult, error) {
	// Try TikWM first if provider is tikwm_first and circuit is not open
	if d.cfg.TikTokProvider == "tikwm_first" && !tikWmCircuit.IsOpen() {
		res, err := d.downloadTikTokViaTikWM(ctx, mediaURL)
		if err == nil && res != nil {
			tikWmCircuit.RecordSuccess()
			return res, nil
		}
		tikWmCircuit.RecordFailure()
	}

	// Fallback to yt-dlp
	return d.Download(ctx, mediaURL, QualityCompact, onProgress)
}

func (d *Downloader) downloadTikTokViaTikWM(ctx context.Context, mediaURL string) (*DownloadResult, error) {
	apiURL := fmt.Sprintf("https://www.tikwm.com/api/?url=%s", url.QueryEscape(mediaURL))

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("tikwm api http %d", resp.StatusCode)
	}

	var data tikWmResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	if data.Code != 0 || data.Data == nil || data.Data.Play == "" {
		return nil, fmt.Errorf("tikwm returned error: %s", data.Msg)
	}

	playURL := data.Data.Play
	if !utils.IsSafeHTTPS(playURL) {
		return nil, fmt.Errorf("insecure or invalid play url")
	}

	// SSRF check
	safe, err := utils.ValidateSafeURL(playURL)
	if err != nil || !safe {
		return nil, fmt.Errorf("ssrf check failed for play url")
	}

	tmpDir, err := os.MkdirTemp("", "mimo-tiktok-")
	if err != nil {
		return nil, err
	}
	videoPath := filepath.Join(tmpDir, "tiktok.mp4")

	dlReq, err := http.NewRequestWithContext(ctx, "GET", playURL, nil)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	dlClient := &http.Client{Timeout: 30 * time.Second}
	dlResp, err := dlClient.Do(dlReq)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != 200 {
		os.RemoveAll(tmpDir)
		return nil, fmt.Errorf("download video http %d", dlResp.StatusCode)
	}

	f, err := os.Create(videoPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	defer f.Close()

	written, err := io.Copy(f, dlResp.Body)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}

	author := ""
	if data.Data.Author != nil {
		if data.Data.Author.Nickname != "" {
			author = data.Data.Author.Nickname
		} else {
			author = data.Data.Author.UniqueID
		}
	}

	title := data.Data.Title
	if title == "" {
		title = "TikTok"
	}

	utils.AdjustCachedUsedMB(written / (1024 * 1024))

	return &DownloadResult{
		MediaPath:       videoPath,
		VideoPath:       videoPath,
		MediaType:       "video",
		FileSizeBytes:   written,
		Title:           title,
		DurationSeconds: data.Data.Duration,
		PlatformName:    "TikTok",
		Author:          author,
		TempDirectory:   tmpDir,
	}, nil
}
