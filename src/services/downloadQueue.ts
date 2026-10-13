type Task<T> = () => Promise<T>;

export class DownloadQueue {
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private activeCount = 0;
  private readonly concurrency: number;
  private readonly maxQueueSize: number;

  constructor(concurrency = 1, maxQueueSize = 10) {
    this.concurrency = concurrency;
    this.maxQueueSize = maxQueueSize;
  }

  async add<T>(task: Task<T>): Promise<T> {
    if (this.activeCount >= this.concurrency) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new Error("سقف مجاز: صف دانلود سرور پر است. لطفاً چند دقیقه دیگر تلاش کنید.");
      }
      await new Promise<void>((resolve, reject) => {
        this.queue.push({ resolve, reject });
      });
    }

    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next.resolve();
    }
  }

  get waitingCount(): number {
    return this.queue.length;
  }
}
