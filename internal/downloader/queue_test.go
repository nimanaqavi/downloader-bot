package downloader

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Three jobs run at once, a fourth waits for a free slot, and nothing about the
// wait is surfaced to the caller (the bot keeps showing its normal status).
func TestQueueCapsConcurrency(t *testing.T) {
	const slots = 3
	q := NewQueue(slots)

	var running, peak int32
	release := make(chan struct{})
	started := make(chan struct{}, 8)
	var wg sync.WaitGroup

	for i := int64(1); i <= slots+1; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			_, _ = q.Add(id, func() (*DownloadResult, error) {
				n := atomic.AddInt32(&running, 1)
				for {
					p := atomic.LoadInt32(&peak)
					if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
						break
					}
				}
				started <- struct{}{}
				<-release
				atomic.AddInt32(&running, -1)
				return &DownloadResult{}, nil
			})
		}(i)
	}

	for i := 0; i < slots; i++ {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d of %d jobs started", i, slots)
		}
	}

	select {
	case <-started:
		t.Fatal("a 4th job started while all slots were busy")
	case <-time.After(200 * time.Millisecond):
	}

	close(release)
	wg.Wait()

	if got := atomic.LoadInt32(&peak); got != slots {
		t.Fatalf("peak concurrency = %d, want %d", got, slots)
	}
	if w, a := q.Stats(); w != 0 || a != 0 {
		t.Fatalf("stats after drain = (%d,%d), want (0,0)", w, a)
	}
}

func TestQueueRejectsSecondJobForSameUser(t *testing.T) {
	q := NewQueue(1)
	release := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = q.Add(7, func() (*DownloadResult, error) { <-release; return &DownloadResult{}, nil })
	}()
	time.Sleep(100 * time.Millisecond)

	if _, err := q.Add(7, func() (*DownloadResult, error) { return &DownloadResult{}, nil }); err != ErrActiveJob {
		t.Fatalf("second job for same user: err = %v, want ErrActiveJob", err)
	}
	close(release)
	<-done
}
