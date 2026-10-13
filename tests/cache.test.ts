import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database/migrations.js";
import { CacheRepository } from "../src/database/repositories/cache.js";

describe("Download Cache Repository", () => {
  it("saves, finds, checks quality, and calculates stats", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const cache = new CacheRepository(db);

    assert.equal(cache.hasQuality("https://youtube.com/watch?v=1", "720p"), false);

    cache.save({
      urlNormalized: "https://youtube.com/watch?v=1",
      quality: "720p",
      chatId: "123456",
      messageId: 99,
      fileSizeBytes: 15 * 1024 * 1024,
      mediaType: "video",
      title: "Test Video",
      durationSeconds: 120
    });

    assert.equal(cache.hasQuality("https://youtube.com/watch?v=1", "720p"), true);
    assert.equal(cache.hasQuality("https://youtube.com/watch?v=1", "360p"), false);

    const item = cache.find("https://youtube.com/watch?v=1", "720p");
    assert.ok(item);
    assert.equal(item?.chatId, "123456");
    assert.equal(item?.messageId, 99);
    assert.equal(item?.title, "Test Video");

    const stats = cache.stats();
    assert.equal(stats.totalCount, 1);
    assert.equal(stats.totalSavedBytes, 15 * 1024 * 1024);

    cache.clear();
    assert.equal(cache.stats().totalCount, 0);

    db.close();
  });
});
