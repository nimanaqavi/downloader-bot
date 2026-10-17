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
	posChan    chan int
	resultChan chan *queueResult
}

type queueResult struct {
	res *DownloadResult
	err error
}

type Queue struct {
	mu         sync.Mutex
	items      []*queueItem
	activeUser map[int64]bool
	trigger    chan struct{}
}

func NewQueue() *Queue {
	q := &Queue{
		activeUser: make(map[int64]bool),
		trigger:    make(chan struct{}, 1),
	}
	go q.worker()
	return q
}

func (q *Queue) Add(
	userID int64,
	fn func() (*DownloadResult, error),
	onPosition func(pos int),
) (*DownloadResult, error) {
	q.mu.Lock()
	if q.activeUser[userID] {
		q.mu.Unlock()
		return nil, ErrActiveJob
	}
	q.activeUser[userID] = true

	item := &queueItem{
		userID:     userID,
		run:        fn,
		posChan:    make(chan int, 5),
		resultChan: make(chan *queueResult, 1),
	}

	q.items = append(q.items, item)
	pos := len(q.items)
	q.mu.Unlock()

	// Notify initial position if queued behind another task
	if pos > 1 && onPosition != nil {
		onPosition(pos - 1)
	}

	// Listen for position updates in background
	stopPos := make(chan struct{})
	go func() {
		for {
			select {
			case newPos, ok := <-item.posChan:
				if !ok {
					return
				}
				if onPosition != nil {
					onPosition(newPos)
				}
			case <-stopPos:
				return
			}
		}
	}()

	// Signal worker
	select {
	case q.trigger <- struct{}{}:
	default:
	}

	res := <-item.resultChan
	close(stopPos)

	return res.res, res.err
}

func (q *Queue) worker() {
	for range q.trigger {
		for {
			q.mu.Lock()
			if len(q.items) == 0 {
				q.mu.Unlock()
				break
			}
			current := q.items[0]
			q.mu.Unlock()

			// Run task
			res, err := current.run()

			// Immediately reclaim memory
			runtime.GC()

			current.resultChan <- &queueResult{res: res, err: err}

			q.mu.Lock()
			delete(q.activeUser, current.userID)
			q.items = q.items[1:]

			// Update positions of remaining items
			for i, remaining := range q.items {
				pos := i + 1
				select {
				case remaining.posChan <- pos:
				default:
				}
			}
			q.mu.Unlock()
		}
	}
}

func (q *Queue) Stats() (waiting int, active int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	total := len(q.items)
	if total == 0 {
		return 0, 0
	}
	return total - 1, 1
}
