# Comprehensive Stress Testing, Chaos Simulation & Performance Visualization Suite for Mimo Bot

You are assigned to perform an exhaustive, multi-scenario load test, chaos engineering audit, and stress test on the "Mimo" Telegram Downloader Bot codebase (Go / SQLite WAL / yt-dlp / ffmpeg / gotd/td MTProto). 

Your goal is to inspect the architecture, write automated benchmarks/load simulation tools, verify edge cases under high concurrent user load, fix any uncovered bugs or race conditions, and generate an executive multi-panel analytical graph (`stress_test_report.png`) committed directly into the repository.

---

### Phase 1: Codebase Inspection & Scenario Checklist (TODO)
Execute and track the following action items:

- [ ] **1. Architecture & Race Condition Audit:**
  - Audit all mutex locks, channels, and shared in-memory maps in `internal/bot`, `internal/downloader`, `internal/database`, and `internal/utils`.
  - Run `go test -race ./...` to detect any data races or deadlocks under concurrent execution.

- [ ] **2. High-Concurrency & Traffic Storm Simulation:**
  - Build a mock load testing harness (in Go or Python) simulating virtual concurrent users scaling from 1 to 250:
    - User burst sending `/start`, `/language`, and `/history` commands.
    - Concurrent submission of valid media URLs (YouTube, Instagram, TikTok, generic web).
    - Rapid-fire callback clicks on inline keyboard buttons (including `\f` prefixed telebot callbacks, quality selection `720p/480p/360p/audio`, `cancel`, and `mp3:<id>`).
  - Verify `RateLimiter` effectiveness (3 req/min sliding window) against burst traffic without leaking memory.
  - Verify `DownloadQueue` behavior with strict `concurrency: 1`:
    - Confirm queue order preservation and accurate queue wait messaging (`d.QueueWaiting(pos)`).
    - Ensure a single user cannot occupy more than 1 active job (`ErrActiveJob`).
    - Verify workers do not deadlock when tasks timeout or fail.

- [ ] **3. Database Resilience (SQLite in WAL Mode):**
  - Simulate heavy concurrent read operations (`download_cache` hits, user lookup, history retrieval) interleaved with write operations (new user registration, logging downloads, cache invalidation, dynamic settings).
  - Assert zero occurrences of `SQLITE_BUSY` or database lockups under high concurrency with `busy_timeout = 5000`.

- [ ] **4. Memory, Disk & Chaos Edge-Case Verification:**
  - Verify memory confinement under `debug.SetMemoryLimit(100 * 1024 * 1024)` and verify that `runtime.GC()` effectively recovers memory after heavy allocations.
  - Test SSRF filter against dangerous IP ranges (`127.0.0.1`, `localhost`, `169.254.169.254`, `::1`, link-local, private RFC 1918 subnets, and `.local`/`.internal` domains).
  - Verify disk budget checks (`MAX_DISK_BUDGET_MB=1000` with cached du/delta updates) when handling large files.
  - Verify deterministic cleanup of temporary folders in `TMPDIR` on success, timeout, cancellation, or crash.
  - Verify instant cache-hit delivery (`copyMessage`) bypasses the download queue with 0 bytes of disk and RAM overhead.

---

### Phase 2: Automated Benchmark & Visual Reporting (`stress_test_report.png`)
Develop and run a standalone benchmark simulation script (using Python `matplotlib` or Go chart libraries) that executes the load suite, records timestamps and metrics, and produces a publication-grade, high-resolution 4-panel dashboard saved as `stress_test_report.png` in the repository root:

1. **Panel 1: Memory (RAM RSS & Heap) vs. Time & User Load:**
   - X-axis: Elapsed Time (seconds) with escalating virtual user tiers (10 -> 50 -> 100 -> 250).
   - Y-axis: Memory Usage (MB).
   - Include distinct curves for Heap Allocated, RSS, and post-GC reclamation.
   - Include clear horizontal threshold lines at 100 MB (Go Target Limit) and 256 MB (Server Hard Limit).
2. **Panel 2: Latency Percentiles (p50, p95, p99) vs. Concurrency:**
   - X-axis: Concurrent Virtual Users.
   - Y-axis: Latency (milliseconds / seconds).
   - Curves for: Inline Callback Response, Cache-Hit Instant Delivery, Queue Wait Delay.
3. **Panel 3: Request Throughput & Outcome Breakdown:**
   - Stacked bar or area chart over time showing requests sorted into:
     - `Successful Deliveries`
     - `Instant Cache-Hits`
     - `Queue Dispatched`
     - `Rate-Limited (429 Throttled)`
     - `SSRF / Security Blocked`
4. **Panel 4: SQLite WAL Operations/sec & Disk Oscillation:**
   - Primary Y-axis: Read & Write Transactions per second.
   - Secondary Y-axis: Temporary Disk Allocation (MB) showing creation and immediate deferred cleanup.

---

### Phase 3: Bug Fixing & Deliverables
1. If any bottleneck, race condition, memory leak, unhandled error, or edge-case failure is discovered during testing, fix it directly in the Go source files.
2. Ensure the full test suite passes cleanly (`go test ./...` and `go test -race ./...`).
3. Commit all benchmark scripts, fixes, and the final `stress_test_report.png` image to the repository with a concise technical commit message.
