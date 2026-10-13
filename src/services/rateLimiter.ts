export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.maximum) {
      this.attempts.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000))
      };
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
