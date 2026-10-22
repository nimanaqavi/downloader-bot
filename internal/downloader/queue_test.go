package downloader

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Three jobs run at once, a fourth waits for a free slot, and a second
// submission from a user who is already active is rejected.
func TestQueueSlotsAndDedupe(t *testing.T) {
	q := NewQueue(3)
	release := make(chan struct{})
	var started atomic.Int32
	var wg sync.WaitGroup

	var mu sync.Mutex
	startedUsers := map[int64]bool{}

	wg.Add(4)
	for i := int64(1); i <= 4; i++ {
		uid := i
		go func() {
			defer wg.Done()
			_, _ = q.Add(uid, func() (*DownloadResult, error) {
				mu.Lock()
				startedUsers[uid] = true
				mu.Unlock()
				started.Add(1)
				<-release
				return &DownloadResult{}, nil
			})
		}()
		time.Sleep(20 * time.Millisecond) // keep submission order
	}

	time.Sleep(300 * time.Millisecond)
	if got := started.Load(); got != 3 {
		t.Fatalf("expected 3 concurrent jobs, got %d", got)
	}

	if _, err := q.Add(1, func() (*DownloadResult, error) { return &DownloadResult{}, nil }); err != ErrActiveJob {
		t.Fatalf("expected ErrActiveJob for an already active user, got %v", err)
	}

	close(release)
	wg.Wait()

	if got := started.Load(); got != 4 {
		t.Fatalf("expected the queued job to run after a slot freed, got %d", got)
	}
	if w, a := q.Stats(); w != 0 || a != 0 {
		t.Fatalf("expected empty queue, got waiting=%d active=%d", w, a)
	}
}
