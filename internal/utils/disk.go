package utils

import (
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	diskMu         sync.RWMutex
	cachedUsedMB   int64 = 150
	lastCalculated time.Time
	cacheTTL       = 10 * time.Minute
)

func GetAccountUsedMB(homeDir string) int64 {
	diskMu.RLock()
	if time.Since(lastCalculated) < cacheTTL && cachedUsedMB > 0 {
		val := cachedUsedMB
		diskMu.RUnlock()
		return val
	}
	diskMu.RUnlock()

	diskMu.Lock()
	defer diskMu.Unlock()

	// Double check
	if time.Since(lastCalculated) < cacheTTL && cachedUsedMB > 0 {
		return cachedUsedMB
	}

	if homeDir == "" {
		homeDir = "."
	}

	cmd := exec.Command("du", "-sm", homeDir)
	out, err := cmd.Output()
	if err == nil {
		fields := strings.Fields(string(out))
		if len(fields) > 0 {
			mb, parseErr := strconv.ParseInt(fields[0], 10, 64)
			if parseErr == nil && mb > 0 {
				cachedUsedMB = mb
				lastCalculated = time.Now()
				return cachedUsedMB
			}
		}
	}

	// Fallback if du is unavailable or fails
	lastCalculated = time.Now()
	return cachedUsedMB
}

func AdjustCachedUsedMB(deltaMB int64) {
	diskMu.Lock()
	defer diskMu.Unlock()
	cachedUsedMB += deltaMB
	if cachedUsedMB < 0 {
		cachedUsedMB = 0
	}
}

func CheckDiskBudget(homeDir string, neededBytes int64, maxBudgetMB int64, safetyMarginBytes int64) bool {
	usedMB := GetAccountUsedMB(homeDir)
	usedBytes := usedMB * 1024 * 1024
	maxBytes := maxBudgetMB * 1024 * 1024

	if (usedBytes + neededBytes + safetyMarginBytes) > maxBytes {
		return false
	}
	return true
}
