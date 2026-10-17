package utils

import (
	"sync"
	"time"
)

type RateLimiter struct {
	mu           sync.Mutex
	maxRequests  int
	window       time.Duration
	userRequests map[int64][]time.Time
}

type RateLimitResult struct {
	Allowed           bool
	RetryAfterSeconds int
}

func NewRateLimiter(maxRequests int, windowSeconds int) *RateLimiter {
	return &RateLimiter{
		maxRequests:  maxRequests,
		window:       time.Duration(windowSeconds) * time.Second,
		userRequests: make(map[int64][]time.Time),
	}
}

func (rl *RateLimiter) Consume(userID int64) RateLimitResult {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	timestamps := rl.userRequests[userID]
	var valid []time.Time
	for _, t := range timestamps {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.maxRequests {
		oldest := valid[0]
		remaining := rl.window - now.Sub(oldest)
		sec := int(remaining.Seconds())
		if sec <= 0 {
			sec = 1
		}
		rl.userRequests[userID] = valid
		return RateLimitResult{
			Allowed:           false,
			RetryAfterSeconds: sec,
		}
	}

	valid = append(valid, now)
	rl.userRequests[userID] = valid
	return RateLimitResult{
		Allowed:           true,
		RetryAfterSeconds: 0,
	}
}
