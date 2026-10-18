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
	"strings"
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
		WMPlay   string  `json:"wmplay"`
		HDPlay   string  `json:"hdplay"`
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
		res, err := d.downloadTikTokViaTikWM(ctx, mediaURL, onProgress)
		if err == nil && res != nil {
			tikWmCircuit.RecordSuccess()
			return res, nil
		}
		tikWmCircuit.RecordFailure()
	}

	// Fallback to yt-dlp (which uses format best[ext=mp4]/best without height limits)
	return d.Download(ctx, mediaURL, QualityCompact, onProgress)
}

func (d *Downloader) downloadTikTokViaTikWM(ctx context.Context, mediaURL string, onProgress ProgressCallback) (*DownloadResult, error) {
	apiURL := "https://www.tikwm.com/api/"
	form := url.Values{}
	form.Set("url", mediaURL)
	form.Set("hd", "1")

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Referer", "https://www.tikwm.com/")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		// Fallback to GET
		getURL := fmt.Sprintf("https://www.tikwm.com/api/?url=%s&hd=1", url.QueryEscape(mediaURL))
		getReq, getErr := http.NewRequestWithContext(ctx, "GET", getURL, nil)
		if getErr != nil {
			return nil, getErr
		}
		getReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
		getReq.Header.Set("Referer", "https://www.tikwm.com/")
		resp, err = client.Do(getReq)
		if err != nil {
			return nil, err
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("tikwm api http %d", resp.StatusCode)
	}

	var data tikWmResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	if data.Code != 0 || data.Data == nil {
		return nil, fmt.Errorf("tikwm returned error: %s", data.Msg)
	}

	// Pick video URL: prefer HDPlay, then Play, then WMPlay
	var playURL string
	if data.Data.HDPlay != "" {
		playURL = data.Data.HDPlay
	} else if data.Data.Play != "" {
		playURL = data.Data.Play
	} else if data.Data.WMPlay != "" {
		playURL = data.Data.WMPlay
	}

	if playURL == "" {
		return nil, fmt.Errorf("no play url in tikwm response")
	}

	// Normalize relative URLs
	if strings.HasPrefix(playURL, "//") {
		playURL = "https:" + playURL
	} else if strings.HasPrefix(playURL, "/") {
		playURL = "https://www.tikwm.com" + playURL
	}

	// SSRF check
	safe, err := utils.ValidateSafeURL(playURL)
	if err != nil || !safe {
		return nil, fmt.Errorf("ssrf check failed for play url: %w", err)
	}

	tmpDir, err := os.MkdirTemp(d.cfg.TempDir, "mimo-tiktok-")
	if err != nil {
		return nil, err
	}
	videoPath := filepath.Join(tmpDir, "tiktok.mp4")

	dlReq, err := http.NewRequestWithContext(ctx, "GET", playURL, nil)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	dlReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	dlReq.Header.Set("Referer", "https://www.tikwm.com/")

	dlClient := &http.Client{
		Timeout: 45 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return http.ErrUseLastResponse
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
			req.Header.Set("Referer", "https://www.tikwm.com/")
			return nil
		},
	}
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

	bodyReader := io.Reader(dlResp.Body)
	if onProgress != nil && dlResp.ContentLength > 0 {
		bodyReader = &progressReader{
			reader:     dlResp.Body,
			total:      dlResp.ContentLength,
			onProgress: onProgress,
			lastPct:    -1,
		}
	}

	written, err := io.Copy(f, bodyReader)
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

	width, height, dur, _ := d.EnsureFaststartAndProbe(videoPath)
	if dur == 0 {
		dur = data.Data.Duration
	}

	return &DownloadResult{
		MediaPath:       videoPath,
		VideoPath:       videoPath,
		MediaType:       "video",
		FileSizeBytes:   written,
		Title:           title,
		DurationSeconds: dur,
		Width:           width,
		Height:          height,
		PlatformName:    "TikTok",
		Author:          author,
		TempDirectory:   tmpDir,
	}, nil
}

type progressReader struct {
	reader     io.Reader
	total      int64
	read       int64
	onProgress ProgressCallback
	lastPct    int
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	if n > 0 {
		pr.read += int64(n)
		if pr.total > 0 {
			pct := int(float64(pr.read) * 100 / float64(pr.total))
			if pct > 100 {
				pct = 100
			}
			if pct >= pr.lastPct+5 || pct == 100 {
				pr.lastPct = pct
				pr.onProgress(pct)
			}
		}
	}
	return n, err
}
