import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database/migrations.js";
import { DownloadsRepository } from "../src/database/repositories/downloads.js";
import { UsersRepository } from "../src/database/repositories/users.js";

describe("Database Migrations & URL Column", () => {
  it("runs migrations and supports universal url column", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const users = new UsersRepository(db);
    const downloads = new DownloadsRepository(db);

    const user = users.upsert("12345678", "testuser");
    assert.ok(user);

    downloads.create(user.id, "https://www.youtube.com/watch?v=abc", "success", 1024);
    downloads.create(user.id, "https://instagram.com/reel/xyz", "success", 2048);

    assert.equal(downloads.countForUser(user.id), 2);

    const history = downloads.listForUser(user.id, 0, 10);
    assert.equal(history.length, 2);
    const urls = history.map((h) => h.url);
    assert.ok(urls.includes("https://www.youtube.com/watch?v=abc"));
    assert.ok(urls.includes("https://instagram.com/reel/xyz"));

    db.close();
  });
});
