export interface JobMetric {
  platform: string;
  metaMs: number;
  downloadMs: number;
  uploadMs: number;
  totalMs: number;
  fileSizeBytes: number;
  speedMBs: number;
  timestamp: number;
}

export interface MetricsSummary {
  totalJobs: number;
  medianSpeedMBs: number;
  p95SpeedMBs: number;
  medianDurationSec: number;
  p95DurationSec: number;
  averageFileSizeMB: number;
}

class MetricsManager {
  private metrics: JobMetric[] = [];
  private readonly MAX_RECORDS = 500;

  record(metric: Omit<JobMetric, "timestamp">): void {
    this.metrics.push({
      ...metric,
      timestamp: Date.now()
    });
    if (this.metrics.length > this.MAX_RECORDS) {
      this.metrics.shift();
    }

    console.info(
      `[perf metric] Platform: ${metric.platform} | Size: ${(metric.fileSizeBytes / 1024 / 1024).toFixed(1)}MB | ` +
      `Meta: ${metric.metaMs}ms | Download: ${metric.downloadMs}ms | Upload: ${metric.uploadMs}ms | ` +
      `Speed: ${metric.speedMBs.toFixed(2)} MB/s | Total: ${Math.round(metric.totalMs / 1000)}s`
    );
  }

  getSummary(): MetricsSummary {
    if (this.metrics.length === 0) {
      return {
        totalJobs: 0,
        medianSpeedMBs: 0,
        p95SpeedMBs: 0,
        medianDurationSec: 0,
        p95DurationSec: 0,
        averageFileSizeMB: 0
      };
    }

    const speeds = this.metrics.map((m) => m.speedMBs).sort((a, b) => a - b);
    const durations = this.metrics.map((m) => m.totalMs / 1000).sort((a, b) => a - b);
    const totalBytes = this.metrics.reduce((acc, m) => acc + m.fileSizeBytes, 0);

    return {
      totalJobs: this.metrics.length,
      medianSpeedMBs: this.getPercentile(speeds, 0.5),
      p95SpeedMBs: this.getPercentile(speeds, 0.95),
      medianDurationSec: Math.round(this.getPercentile(durations, 0.5)),
      p95DurationSec: Math.round(this.getPercentile(durations, 0.95)),
      averageFileSizeMB: Math.round(totalBytes / this.metrics.length / 1024 / 1024)
    };
  }

  private getPercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[index] ?? 0;
  }
}

export const metricsManager = new MetricsManager();
