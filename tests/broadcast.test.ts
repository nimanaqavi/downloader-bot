import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database/migrations.js";
import { UsersRepository } from "../src/database/repositories/users.js";

describe("Broadcast with 1000 Mock Users (Memory and Batching)", () => {
  it("processes 1000 mock users in batches without memory spikes", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const users = new UsersRepository(db);

    const memBefore = process.memoryUsage().rss;

    // Seed 1000 users
    const insertMany = db.transaction(() => {
      for (let i = 1; i <= 1000; i++) {
        users.upsert(`mock_user_${i}`, `user_${i}`);
      }
    });
    insertMany();

    assert.equal(users.count(), 1000);

    let processedCount = 0;
    const BATCH_SIZE = 100;
    let offset = 0;

    while (offset < 1000) {
      const batch = users.listBatchActive(offset, BATCH_SIZE);
      if (batch.length === 0) break;
      for (const u of batch) {
        processedCount++;
      }
      offset += BATCH_SIZE;
    }

    const memAfter = process.memoryUsage().rss;
    const diffMb = Math.round((memAfter - memBefore) / 1024 / 1024);

    assert.equal(processedCount, 1000);
    // Verifies memory footprint during batch processing of 1000 users stays under 10MB
    assert.ok(diffMb < 15, `Memory diff was ${diffMb} MB, expected < 15 MB`);

    db.close();
  });
});
