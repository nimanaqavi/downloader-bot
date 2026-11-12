package utils

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateSafeURL(t *testing.T) {
	// Must reject loopback & local
	for _, bad := range []string{
		"http://127.0.0.1:8080/test",
		"http://localhost:3000",
		"https://10.0.0.1/admin",
		"http://192.168.1.1/router",
		"ftp://example.com/file",
	} {
		safe, err := ValidateSafeURL(bad)
		if safe || err == nil {
			t.Errorf("expected %s to be rejected by SSRF, got safe=%v err=%v", bad, safe, err)
		}
	}

	// Must accept valid public URLs
	for _, good := range []string{
		"https://1.1.1.1/test",
		"http://8.8.8.8/",
	} {
		safe, err := ValidateSafeURL(good)
		if !safe || err != nil {
			t.Errorf("expected %s to be accepted by SSRF, got safe=%v err=%v", good, safe, err)
		}
	}
}

func TestNormalizeMediaURL(t *testing.T) {
	raw := "https://www.instagram.com/reel/C8XYZ/?igsh=abcd123&utm_source=ig_web_copy_link&utm_medium=share_sheet"
	normalized := NormalizeMediaURL(raw)
	if strings.Contains(normalized, "igsh") || strings.Contains(normalized, "utm_") {
		t.Errorf("expected tracking params removed, got: %s", normalized)
	}
}

func TestFormattingAndCaptions(t *testing.T) {
	dur := FormatDuration(125)
	if dur != "02:05" {
		t.Errorf("expected 02:05, got %s", dur)
	}

	bytesStr := FormatBytes(15*1024*1024, "fa")
	if !strings.Contains(bytesStr, "مگابایت") {
		t.Errorf("expected Persian byte format, got %s", bytesStr)
	}

	caption := BuildFinalCaption(FinalCaptionOpts{
		Title:           "Test Video",
		DurationSeconds: 125,
		FileSizeBytes:   15 * 1024 * 1024,
		PlatformName:    "YouTube",
		BotUsername:     "instagramdl_mahibot",
	})
	if !strings.Contains(caption, "Test Video") || !strings.Contains(caption, "@instagramdl_mahibot") {
		t.Errorf("caption missing title or bot username: %s", caption)
	}
}

func TestCheckDiskBudget(t *testing.T) {
	dir := t.TempDir()

	// A small tree must pass a generous budget.
	if !CheckDiskBudget(dir, 10*1024*1024, 1000, 100*1024*1024) {
		t.Errorf("expected small tree to pass budget")
	}

	// A budget smaller than the safety margin must always refuse,
	// regardless of how empty the directory is.
	if CheckDiskBudget(dir, 10*1024*1024, 100, 100*1024*1024) {
		t.Errorf("expected refusal when margin alone exceeds budget")
	}

	// Unreadable path must not panic and must refuse.
	if CheckDiskBudget(filepath.Join(dir, "nope"), 1, 1000, 0) {
		t.Errorf("expected refusal for a path that cannot be measured")
	}
}

func TestAccountUsedMB(t *testing.T) {
	dir := t.TempDir()

	// Write ~1MB and confirm the measurement is in the right ballpark.
	blob := make([]byte, 1024*1024)
	if err := os.WriteFile(filepath.Join(dir, "blob.bin"), blob, 0o644); err != nil {
		t.Fatal(err)
	}

	// du -sm rounds up, so anything from 1MB to a few MB is acceptable.
	if got := AccountUsedMB(dir); got < 1 || got > 8 {
		t.Errorf("expected ~1MB measured, got %d MB", got)
	}
}

func TestCleanAudioFileName(t *testing.T) {
	cases := []struct {
		author, title, fallback, want string
	}{
		{"Eminem", "Lose Yourself", "/tmp/dl.mp3", "Eminem - Lose Yourself.mp3"},
		{"AC/DC", "Back in Black", "/tmp/dl.mp3", "AC_DC - Back in Black.mp3"},
		{"", "Single Track", "/tmp/dl.mp3", "Single Track.mp3"},
		{"Solo Artist", "", "/tmp/dl.mp3", "Solo Artist.mp3"},
		{"", "", "/tmp/mimo-123.mp3", "mimo-123.mp3"},
		{"", "", "/tmp/mimo-raw", "mimo-raw.mp3"},
	}
	for _, tc := range cases {
		if got := CleanAudioFileName(tc.author, tc.title, tc.fallback); got != tc.want {
			t.Errorf("CleanAudioFileName(%q, %q, %q) = %q; want %q", tc.author, tc.title, tc.fallback, got, tc.want)
		}
	}
}

func TestCleanVideoFileName(t *testing.T) {
	cases := []struct {
		author, title, fallback, want string
	}{
		{"Channel", "My Video", "/tmp/dl.mp4", "Channel - My Video.mp4"},
		{"Same", "Same", "/tmp/dl.mp4", "Same.mp4"},
		{"", "Video Only", "/tmp/dl.mp4", "Video Only.mp4"},
		{"", "Media", "/tmp/fallback.mp4", "fallback.mp4"},
		{"", "", "/tmp/raw-123", "raw-123.mp4"},
	}
	for _, tc := range cases {
		if got := CleanVideoFileName(tc.author, tc.title, tc.fallback); got != tc.want {
			t.Errorf("CleanVideoFileName(%q, %q, %q) = %q; want %q", tc.author, tc.title, tc.fallback, got, tc.want)
		}
	}
}
