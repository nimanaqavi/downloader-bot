package main

import (
	"encoding/csv"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"mimo/internal/database"
	"mimo/internal/downloader"
	"mimo/internal/utils"
)

type Metric struct {
	Timestamp      int64
	Users          int
	MemHeapAllocMB float64
	MemRSSMB       float64
	P50LatencyMs   float64
	P95LatencyMs   float64
	P99LatencyMs   float64
	Success        int64
	CacheHits      int64
	QueueWait      int64
	RateLimited    int64
	SSRFBlocked    int64
	DBReadOps      int64
	DBWriteOps     int64
	DiskTempMB     float64
}

func calculatePercentiles(latencies []float64) (p50, p95, p99 float64) {
	if len(latencies) == 0 {
		return 0, 0, 0
	}
	sorted := make([]float64, len(latencies))
	copy(sorted, latencies)
	sort.Float64s(sorted)

	p50 = sorted[int(float64(len(sorted))*0.50)]
	p95 = sorted[int(float64(len(sorted))*0.95)]
	p99 = sorted[int(float64(len(sorted))*0.99)]
	return p50, p95, p99
}

func main() {
	// Setup DB for test
	dbPath := "./data/stress_test.db"
	os.RemoveAll(filepath.Dir(dbPath))
	os.MkdirAll(filepath.Dir(dbPath), 0755)

	db, err := database.Connect(dbPath)
	if err != nil {
		log.Fatalf("Failed to connect DB: %v", err)
	}
	defer db.Close()

	// Initialize components
	rl := utils.NewRateLimiter(3, 60)
	queue := downloader.NewQueue()

	metrics := make(chan Metric, 1000)
	var wg sync.WaitGroup

	// Concurrency tiers
	tiers := []int{10, 50, 100, 250}
	durationPerTier := 15 * time.Second

	csvFile, err := os.Create("stress_metrics.csv")
	if err != nil {
		log.Fatalf("Failed to create CSV: %v", err)
	}
	defer csvFile.Close()

	writer := csv.NewWriter(csvFile)
	writer.Write([]string{
		"Timestamp", "Users", "MemHeapMB", "MemRSSMB",
		"P50LatMs", "P95LatMs", "P99LatMs",
		"Success", "CacheHits", "QueueWait", "RateLimited", "SSRFBlocked",
		"DBReadOps", "DBWriteOps", "DiskTempMB",
	})

	var globalSuccess int64
	var globalCacheHits int64
	var globalQueueWait int64
	var globalRateLimited int64
	var globalSSRFBlocked int64

	// Metrics collector
	go func() {
		for m := range metrics {
			writer.Write([]string{
				fmt.Sprintf("%d", m.Timestamp),
				fmt.Sprintf("%d", m.Users),
				fmt.Sprintf("%.2f", m.MemHeapAllocMB),
				fmt.Sprintf("%.2f", m.MemRSSMB),
				fmt.Sprintf("%.2f", m.P50LatencyMs),
				fmt.Sprintf("%.2f", m.P95LatencyMs),
				fmt.Sprintf("%.2f", m.P99LatencyMs),
				fmt.Sprintf("%d", m.Success),
				fmt.Sprintf("%d", m.CacheHits),
				fmt.Sprintf("%d", m.QueueWait),
				fmt.Sprintf("%d", m.RateLimited),
				fmt.Sprintf("%d", m.SSRFBlocked),
				fmt.Sprintf("%d", m.DBReadOps),
				fmt.Sprintf("%d", m.DBWriteOps),
				fmt.Sprintf("%.2f", m.DiskTempMB),
			})
			writer.Flush()
		}
	}()

	startTime := time.Now()

	for _, tier := range tiers {
		log.Printf("Starting tier with %d concurrent users for %v...", tier, durationPerTier)

		tierStartTime := time.Now()

		// Buffer for actual latencies collected in this second
		var latenciesMu sync.Mutex
		var currentLatencies []float64

		stopChan := make(chan struct{})

		var dbReadOps int64
		var dbWriteOps int64

		// Metric sampler for the tier
		go func(t int) {
			ticker := time.NewTicker(1 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-stopChan:
					return
				case <-ticker.C:
					var memStats runtime.MemStats
					runtime.ReadMemStats(&memStats)

					latenciesMu.Lock()
					lats := make([]float64, len(currentLatencies))
					copy(lats, currentLatencies)
					currentLatencies = currentLatencies[:0]
					latenciesMu.Unlock()

					p50, p95, p99 := calculatePercentiles(lats)

					// Get disk temp MB realistically
					homeDir := "./tmp"
					os.MkdirAll(homeDir, 0755)
					diskMB := utils.GetAccountUsedMB(homeDir)

					m := Metric{
						Timestamp:      time.Now().Unix(),
						Users:          t,
						MemHeapAllocMB: float64(memStats.Alloc) / 1024 / 1024,
						MemRSSMB:       float64(memStats.Sys) / 1024 / 1024,
						P50LatencyMs:   p50,
						P95LatencyMs:   p95,
						P99LatencyMs:   p99,
						Success:        atomic.LoadInt64(&globalSuccess),
						CacheHits:      atomic.LoadInt64(&globalCacheHits),
						QueueWait:      atomic.LoadInt64(&globalQueueWait),
						RateLimited:    atomic.LoadInt64(&globalRateLimited),
						SSRFBlocked:    atomic.LoadInt64(&globalSSRFBlocked),
						DBReadOps:      atomic.SwapInt64(&dbReadOps, 0),
						DBWriteOps:     atomic.SwapInt64(&dbWriteOps, 0),
						DiskTempMB:     float64(diskMB),
					}
					metrics <- m
				}
			}
		}(tier)

		for i := 0; i < tier; i++ {
			wg.Add(1)
			go func(userID int64) {
				defer wg.Done()

				for {
					if time.Since(tierStartTime) > durationPerTier {
						break
					}

					startReq := time.Now()

					// Simulate SSRF check
					url := "https://example.com/video"
					if rand.Float32() < 0.05 {
						url = "http://127.0.0.1/admin"
					}

					isSafe, _ := utils.ValidateSafeURL(url)
					if !isSafe {
						atomic.AddInt64(&globalSSRFBlocked, 1)

						lat := float64(time.Since(startReq).Milliseconds())
						latenciesMu.Lock()
						currentLatencies = append(currentLatencies, lat)
						latenciesMu.Unlock()

						time.Sleep(50 * time.Millisecond)
						continue
					}

					// Simulate Rate Limit
					rlRes := rl.Consume(userID)
					if !rlRes.Allowed {
						atomic.AddInt64(&globalRateLimited, 1)

						lat := float64(time.Since(startReq).Milliseconds())
						latenciesMu.Lock()
						currentLatencies = append(currentLatencies, lat)
						latenciesMu.Unlock()

						time.Sleep(200 * time.Millisecond) // Backoff
						continue
					}

					// Simulate DB Operations (Write/Read)
					if rand.Float32() < 0.3 {
						atomic.AddInt64(&dbWriteOps, 1)
						db.SetSetting("last_active", fmt.Sprintf("%d", time.Now().Unix()))
					} else {
						atomic.AddInt64(&dbReadOps, 1)
						db.GetSetting("force_join_enabled")
					}

					// Simulate Cache Hit or Queue
					if rand.Float32() < 0.4 {
						// Cache hit
						atomic.AddInt64(&globalCacheHits, 1)
						atomic.AddInt64(&globalSuccess, 1)
					} else {
						// Queue
						atomic.AddInt64(&globalQueueWait, 1)

						_, qErr := queue.Add(userID, func() (*downloader.DownloadResult, error) {
							// Simulate download wait
							time.Sleep(10 * time.Millisecond)
							return &downloader.DownloadResult{}, nil
						}, nil)

						if qErr == downloader.ErrActiveJob {
							// Expected under high concurrency per user, ignore or log
						} else if qErr == nil {
							atomic.AddInt64(&globalSuccess, 1)
						}
					}

					lat := float64(time.Since(startReq).Milliseconds())
					latenciesMu.Lock()
					currentLatencies = append(currentLatencies, lat)
					latenciesMu.Unlock()

					time.Sleep(time.Duration(rand.Intn(100)) * time.Millisecond) // Think time
				}
			}(int64(1000 + i)) // Ensure distinct user IDs per tier to avoid cross-tier queues if we didn't clear
		}

		wg.Wait()
		close(stopChan)
		log.Printf("Tier %d finished.", tier)

		// Run GC explicitly between tiers to simulate real GC pressure/recovery
		runtime.GC()
		time.Sleep(2 * time.Second)
	}

	close(metrics)
	log.Printf("Stress test completed in %v", time.Since(startTime))
}
