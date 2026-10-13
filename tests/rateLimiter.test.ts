import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/services/rateLimiter.js";

describe("RateLimiter", () => {
  it("limits attempts inside the window", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.consume("user", 1_000).allowed).toBe(true);
    expect(limiter.consume("user", 2_000).allowed).toBe(true);
    expect(limiter.consume("user", 3_000)).toEqual({ allowed: false, retryAfterSeconds: 58 });
  });

  it("allows attempts after the window expires", () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.consume("user", 1_000).allowed).toBe(true);
    expect(limiter.consume("user", 2_001).allowed).toBe(true);
  });

  it("tracks users independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.consume("first", 1_000).allowed).toBe(true);
    expect(limiter.consume("second", 1_000).allowed).toBe(true);
  });
});
