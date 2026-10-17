package utils

import (
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
