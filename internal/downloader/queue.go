package downloader

import (
	"errors"
	"runtime"
	"sync"
)

var (
	ErrActiveJob = errors.New("شما هم‌اکنون یک دانلود در حال پردازش در صف دارید. لطفاً تا پایان آن صبر کنید")
)

type queueItem struct {
	userID     int64
	run        func() (*DownloadResult, error)
	resultChan chan *queueResult
}

type queueResult struct {
	res *DownloadResult
	err error
}

type Queue struct {
	mu      sync.Mutex
	cond    *sync.Cond
	items   []*queueItem
	active  map[int64]bool
	running int
}

// NewQueue starts `slots` workers. Three concurrent jobs stay under the host's
// RAM ceiling and the kernel splits the link between whoever is running; a
// fourth job just waits its turn silently and starts the moment a slot frees.
func NewQueue(slots int) *Queue {
	q := &Queue{active: make(map[int64]bool)}
	q.cond = sync.NewCond(&q.mu)
	for i := 0; i < slots; i++ {
		go q.worker()
	}
	return q
}

func (q *Queue) Add(userID int64, fn func() (*DownloadResult, error)) (*DownloadResult, error) {
	q.mu.Lock()
	if q.active[userID] {
		q.mu.Unlock()
		return nil, ErrActiveJob
	}
	q.active[userID] = true

	item := &queueItem{userID: userID, run: fn, resultChan: make(chan *queueResult, 1)}
	q.items = append(q.items, item)
	q.cond.Signal()
	q.mu.Unlock()

	res := <-item.resultChan
	return res.res, res.err
}

func (q *Queue) worker() {
	for {
		q.mu.Lock()
		for len(q.items) == 0 {
			q.cond.Wait()
		}
		item := q.items[0]
		q.items = q.items[1:]
		q.running++
		q.mu.Unlock()

		res, err := item.run()

		// Immediately reclaim memory
		runtime.GC()

		q.mu.Lock()
		delete(q.active, item.userID)
		q.running--
		q.mu.Unlock()

		item.resultChan <- &queueResult{res: res, err: err}
	}
}

func (q *Queue) Stats() (waiting int, active int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items), q.running
}
