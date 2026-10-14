export interface GramJsStats {
  floodWaitCount24h: number;
  maxWaitSeconds: number;
  lastUploadError: string;
  lastErrorTimestamp: number | null;
}

interface FloodWaitEvent {
  timestamp: number;
  seconds: number;
}

class GramJsMonitor {
  private floodWaitEvents: FloodWaitEvent[] = [];
  private maxWaitSeconds = 0;
  private lastUploadError = "هیچ (بدون خطا)";
  private lastErrorTimestamp: number | null = null;

  recordFloodWait(seconds: number): void {
    const now = Date.now();
    this.floodWaitEvents.push({ timestamp: now, seconds });
    if (seconds > this.maxWaitSeconds) {
      this.maxWaitSeconds = seconds;
    }
    this.lastUploadError = `FLOOD_WAIT (${seconds}s)`;
    this.lastErrorTimestamp = now;
    this.cleanupOldEvents();
  }

  recordUploadError(errorName: string): void {
    this.lastUploadError = errorName.replace(/[\r\n]+/g, " ").slice(0, 50);
    this.lastErrorTimestamp = Date.now();
  }

  getStats(): GramJsStats {
    this.cleanupOldEvents();
    return {
      floodWaitCount24h: this.floodWaitEvents.length,
      maxWaitSeconds: this.maxWaitSeconds,
      lastUploadError: this.lastUploadError,
      lastErrorTimestamp: this.lastErrorTimestamp
    };
  }

  private cleanupOldEvents(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.floodWaitEvents = this.floodWaitEvents.filter((e) => e.timestamp >= oneDayAgo);
  }
}

export const gramjsMonitor = new GramJsMonitor();
