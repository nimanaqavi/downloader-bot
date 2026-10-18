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
