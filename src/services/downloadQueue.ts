import { triggerGC } from "../utils/gc.js";

type Task<T> = () => Promise<T>;

export class DownloadQueue {
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    userId?: string;
  }> = [];
  private activeCount = 0;
  private activeUsers = new Map<string, number>();
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private readonly maxPerUser: number;

  constructor(concurrency = 1, maxQueueSize = 10, maxPerUser = 1) {
    this.concurrency = concurrency;
    this.maxQueueSize = maxQueueSize;
    this.maxPerUser = maxPerUser;
  }

  async add<T>(task: Task<T>, userId?: string | number): Promise<T> {
    const uKey = userId !== undefined ? String(userId) : undefined;

    // Check per-user limit
    if (uKey) {
      const userCount = this.activeUsers.get(uKey) || 0;
      if (userCount >= this.maxPerUser) {
        throw new Error(
          "شما هم‌اکنون یک دانلود در حال پردازش در صف دارید. لطفاً تا پایان آن صبر کنید."
        );
      }
      this.activeUsers.set(uKey, userCount + 1);
    }

    try {
      if (this.activeCount >= this.concurrency) {
        if (this.queue.length >= this.maxQueueSize) {
          throw new Error("سقف مجاز: صف دانلود سرور پر است. لطفاً چند دقیقه دیگر تلاش کنید.");
        }
        await new Promise<void>((resolve, reject) => {
          this.queue.push({ resolve, reject, userId: uKey });
        });
      }

      this.activeCount++;
      try {
        return await task();
      } finally {
        this.activeCount--;
        const next = this.queue.shift();
        if (next) next.resolve();
        triggerGC();
      }
    } finally {
      if (uKey) {
        const count = this.activeUsers.get(uKey) || 1;
        if (count <= 1) {
          this.activeUsers.delete(uKey);
        } else {
          this.activeUsers.set(uKey, count - 1);
        }
      }
    }
  }

  get waitingCount(): number {
    return this.queue.length;
  }

  get activeCountNumber(): number {
    return this.activeCount;
  }
}
