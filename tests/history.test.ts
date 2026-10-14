import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatHistoryMessages } from "../src/bot/handlers/history.js";
import type { DownloadRecord } from "../src/types/index.js";

describe("History Handler - Full URLs & Message Splitting", () => {
  it("displays full URL without cutting or '...' and properly escapes HTML", () => {
    const longUrl =
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&utm_source=app&q=test%20query%20with%20special%20characters%20<foo>&bar='baz'";
    const records: DownloadRecord[] = [
      {
        id: 1,
        userId: 123,
        url: longUrl,
        platform: "youtube",
        status: "success",
        fileSizeBytes: 1024,
        createdAt: "2026-10-14T03:00:00.000Z"
      }
    ];

    const messages = formatHistoryMessages("YouTube", "▶️", records, "fa", 4096);
    assert.equal(messages.length, 1);
    const msg = messages[0]!;

    // Must NOT contain ellipsis from truncation
    assert.equal(msg.includes("…"), false);
    assert.equal(msg.includes("..."), false);

    // Must contain escaped special characters
    assert.ok(msg.includes("&amp;"));
    assert.ok(msg.includes("&lt;foo&gt;"));
    assert.ok(msg.includes("&#039;baz&#039;"));
    assert.ok(msg.includes("▶️ YouTube"));
  });

  it("splits history into multiple messages when total length exceeds 4096 characters", () => {
    // Construct 5 very long URLs (each ~900 chars) -> Total > 4500 chars
    const records: DownloadRecord[] = [];
    for (let i = 1; i <= 5; i++) {
      const longUrl = `https://example.com/very/long/path/video_${i}?query=${"A".repeat(850)}`;
      records.push({
        id: i,
        userId: 123,
        url: longUrl,
        platform: "generic",
        status: "success",
        fileSizeBytes: 1024 * i,
        createdAt: "2026-10-14T03:00:00.000Z"
      });
    }

    const messages = formatHistoryMessages("All Platforms", "🌐", records, "en", 4096);

    // Must be split into at least 2 messages
    assert.ok(messages.length >= 2, `Expected messages.length >= 2, got ${messages.length}`);

    // Every chunk must be strictly <= 4096 characters
    for (const chunk of messages) {
      assert.ok(chunk.length <= 4096, `Chunk length ${chunk.length} exceeded 4096 characters`);
    }

    // All 5 items must be present across chunks
    for (let i = 1; i <= 5; i++) {
      const found = messages.some((m) => m.includes(`video_${i}`));
      assert.ok(found, `Item video_${i} was not found in any message chunk`);
    }
  });
});
