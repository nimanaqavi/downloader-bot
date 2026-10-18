package downloader_test

import (
	"strings"
	"testing"

	"mimo/internal/downloader"
	"mimo/internal/utils"
)

// The translator must render the "quality not available" card for both languages.
func TestQualityNotAvailableMessage(t *testing.T) {
	err := &downloader.ErrQualityNotAvailable{Requested: "4k", Available: []string{"1080p", "720p", "360p"}}

	fa := utils.FriendlyDownloadError(err, "ERR-TEST", "fa")
	if !strings.Contains(fa, "4k") || !strings.Contains(fa, "1080p") || !strings.Contains(fa, "720p") {
		t.Errorf("fa message missing requested/available qualities: %s", fa)
	}
	if !strings.Contains(fa, "در دسترس نیست") {
		t.Errorf("fa message missing unavailability wording: %s", fa)
	}

	en := utils.FriendlyDownloadError(err, "ERR-TEST", "en")
	if !strings.Contains(en, "4k") || !strings.Contains(en, "not available") {
		t.Errorf("en message incorrect: %s", en)
	}
}
