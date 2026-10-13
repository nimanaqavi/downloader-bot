import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/services/rateLimiter.js";

describe("RateLimiter", () => {
  it("limits attempts inside the window", () => {
    const limiter = new RateLimiter(2, 60_000);
    assert.equal(limiter.consume("user", 1_000).allowed, true);
    assert.equal(limiter.consume("user", 2_000).allowed, true);
    assert.deepEqual(limiter.consume("user", 3_000), { allowed: false, retryAfterSeconds: 58 });
  });

  it("allows attempts after the window expires", () => {
    const limiter = new RateLimiter(1, 1_000);
    assert.equal(limiter.consume("user", 1_000).allowed, true);
    assert.equal(limiter.consume("user", 2_001).allowed, true);
  });

  it("tracks users independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    assert.equal(limiter.consume("first", 1_000).allowed, true);
    assert.equal(limiter.consume("second", 1_000).allowed, true);
  });
});

