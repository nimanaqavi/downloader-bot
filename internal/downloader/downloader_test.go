package downloader

import (
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// box writes an ISO BMFF box header + optional payload.
func box(boxType string, payload int) []byte {
	size := 8 + payload
	b := make([]byte, size)
	binary.BigEndian.PutUint32(b[0:4], uint32(size))
	copy(b[4:8], boxType)
	return b
}

func TestHasFaststartAtom(t *testing.T) {
	dir := t.TempDir()

	fast := filepath.Join(dir, "fast.mp4")
	if err := os.WriteFile(fast, append(box("ftyp", 16), box("moov", 32)...), 0o644); err != nil {
		t.Fatal(err)
	}
	if !hasFaststartAtom(fast) {
		t.Errorf("expected faststart=true when moov precedes mdat")
	}

	// moov after mdat => not streamable
	slow := filepath.Join(dir, "slow.mp4")
	if err := os.WriteFile(slow, append(box("ftyp", 16), append(box("mdat", 256), box("moov", 32)...)...), 0o644); err != nil {
		t.Fatal(err)
	}
	if hasFaststartAtom(slow) {
		t.Errorf("expected faststart=false when mdat precedes moov")
	}

	// Fuzz-ish: truncated / garbage must not panic and must report false
	bad := filepath.Join(dir, "bad.mp4")
	if err := os.WriteFile(bad, []byte{0x00, 0x01}, 0o644); err != nil {
		t.Fatal(err)
	}
	if hasFaststartAtom(bad) {
		t.Errorf("expected faststart=false for truncated file")
	}

	if hasFaststartAtom(filepath.Join(dir, "missing.mp4")) {
		t.Errorf("expected faststart=false for missing file")
	}
}

func TestErrQualityNotAvailable(t *testing.T) {
	err := &ErrQualityNotAvailable{Requested: "4k", Available: []string{"1080p", "720p", "360p"}}

	// The utils error translator matches on this method set.
	type qualityUnavailable interface {
		GetRequestedAndAvailable() (string, []string)
	}

	var target qualityUnavailable
	if !errors.As(error(err), &target) {
		t.Fatalf("error should be detectable via errors.As")
	}

	req, avail := target.GetRequestedAndAvailable()
	if req != "4k" {
		t.Errorf("expected requested=4k, got %s", req)
	}
	if len(avail) != 3 || avail[0] != "1080p" {
		t.Errorf("unexpected available list: %v", avail)
	}
}

func TestScanLinesOrCR(t *testing.T) {
	// yt-dlp emits progress with carriage returns on a single line.
	input := []byte("[download]   0.0%\r[download]  50.0%\r[download] 100.0%\n")
	var lines []string

	for len(input) > 0 {
		advance, token, err := scanLinesOrCR(input, false)
		if err != nil {
			t.Fatal(err)
		}
		if advance == 0 {
			break
		}
		input = input[advance:]
		if len(token) > 0 {
			lines = append(lines, string(token))
		}
	}

	if len(lines) != 3 {
		t.Fatalf("expected 3 progress lines split on \\r and \\n, got %d: %v", len(lines), lines)
	}
	if lines[1] != "[download]  50.0%" {
		t.Errorf("unexpected middle line: %q", lines[1])
	}
}

func TestScanLinesOrCRFinalChunk(t *testing.T) {
	// Trailing partial data must still be emitted at EOF.
	advance, token, err := scanLinesOrCR([]byte("no-newline"), true)
	if err != nil {
		t.Fatal(err)
	}
	if advance != len("no-newline") || string(token) != "no-newline" {
		t.Errorf("expected full token at EOF, got advance=%d token=%q", advance, token)
	}
}

func TestQualitiesFromFormats(t *testing.T) {
	formats := []any{
		map[string]any{"vcodec": "none", "width": 48.0, "height": 27.0},      // audio/storyboard, ignored
		map[string]any{"vcodec": "avc1", "width": 640.0, "height": 360.0},    // 360p
		map[string]any{"vcodec": "avc1", "width": 1280.0, "height": 720.0},   // 720p
		map[string]any{"vcodec": "avc1", "width": 1920.0, "height": 1080.0},  // 1080p
		map[string]any{"vcodec": "vp9", "width": 3840.0, "height": 2160.0},   // 4k
		map[string]any{"vcodec": "avc1", "width": 1080.0, "height": 1920.0},  // vertical 1080p
		map[string]any{"vcodec": "none", "width": 0.0, "height": 0.0},        // empty
	}

	got := qualitiesFromFormats(formats)
	want := []string{"4k", "1080p", "720p", "360p"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("position %d: expected %s, got %s", i, want[i], got[i])
		}
	}
}

func TestQualitiesFromFormatsVerticalOnly(t *testing.T) {
	// A Shorts video whose only resolutions are vertical must still report
	// the correct tiers; the smaller side is the meaningful one.
	formats := []any{
		map[string]any{"vcodec": "avc1", "width": 1080.0, "height": 1920.0},
	}
	got := qualitiesFromFormats(formats)
	if len(got) != 1 || got[0] != "1080p" {
		t.Errorf("expected [1080p] for vertical 1080x1920, got %v", got)
	}
}

func TestQualitiesFromFormatsEmpty(t *testing.T) {
	if got := qualitiesFromFormats(nil); len(got) != 0 {
		t.Errorf("expected empty for nil formats, got %v", got)
	}
}
