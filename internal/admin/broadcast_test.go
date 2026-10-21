package admin

import "testing"

func TestErrorClassification(t *testing.T) {
	cases := []struct {
		msg        string
		wantBlocked bool
		wantFlood   bool
	}{
		{"Forbidden: bot was blocked by the user", true, false},
		{"Bad Request: user is deactivated", true, false},
		{"Too Many Requests: retry after 5", false, true},
		{"flood_wait", false, true},
		{"Bad Request: chat not found", false, false},
		{"Internal Server Error", false, false},
	}
	for _, c := range cases {
		if got := isBlockedError(c.msg); got != c.wantBlocked {
			t.Errorf("isBlockedError(%q) = %v, want %v", c.msg, got, c.wantBlocked)
		}
		if got := isFloodWaitError(c.msg); got != c.wantFlood {
			t.Errorf("isFloodWaitError(%q) = %v, want %v", c.msg, got, c.wantFlood)
		}
	}
}
