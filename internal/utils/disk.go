package utils

import (
	"os/exec"
	"strconv"
	"strings"
)

// measureUsedMB returns how much of the account's disk quota is in use, by
// summing the home directory with du. The account quota (1 GB on Alwaysdata)
// is not visible via statfs, which reports the underlying NFS volume instead,
// so du is the only reliable source.
//
// du takes ~0.1s here, so it runs on every check rather than being cached:
// a cached figure that goes stale after temp files are cleaned up would
// block downloads even when the disk is empty.
func measureUsedMB(homeDir string) (int64, bool) {
	if homeDir == "" {
		homeDir = "."
	}

	out, err := exec.Command("du", "-sm", homeDir).Output()
	if err != nil {
		return 0, false
	}

	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return 0, false
	}

	mb, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, false
	}
	return mb, true
}

// AccountUsedMB reports quota usage in MB, or 0 when it cannot be measured.
// For display only; use CheckDiskBudget when deciding whether to download.
func AccountUsedMB(homeDir string) int64 {
	mb, _ := measureUsedMB(homeDir)
	return mb
}

// CheckDiskBudget reports whether neededBytes fits inside maxBudgetMB after
// allowing for the safety margin. It refuses when usage cannot be measured,
// so a du failure cannot silently let the 1 GB quota fill up.
func CheckDiskBudget(homeDir string, neededBytes int64, maxBudgetMB int64, safetyMarginBytes int64) bool {
	usedMB, ok := measureUsedMB(homeDir)
	if !ok {
		return false
	}

	usedBytes := usedMB * 1024 * 1024
	maxBytes := maxBudgetMB * 1024 * 1024

	return usedBytes+neededBytes+safetyMarginBytes <= maxBytes
}

