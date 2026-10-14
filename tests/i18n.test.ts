import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database/migrations.js";
import { UsersRepository } from "../src/database/repositories/users.js";
import { translations, t, isolate, type Language } from "../src/i18n/index.js";
import { buildFinalCaption } from "../src/utils/formatting.js";
import { pendingLanguageLinks, storePendingLanguageLink } from "../src/bot/handlers/start.js";

describe("i18n Central Dictionary and Translation System", () => {
  it("ensures fa and en dictionaries have matching keys", () => {
    const faKeys = Object.keys(translations.fa).sort();
    const enKeys = Object.keys(translations.en).sort();

    assert.deepEqual(faKeys, enKeys, "FA and EN translation dictionaries must have identical keys");
  });

  it("translates text accurately for both languages without leaking raw Persian into English", () => {
    assert.ok(t("fa", "start").includes("به میمو خوش اومدی"));
    assert.ok(t("en", "start").includes("Welcome to Mimo"));
    assert.equal(t("en", "start").includes("میمو خوش"), false);

    assert.equal(t("fa", "btn_download"), "دانلود");
    assert.equal(t("en", "btn_download"), "Download");

    assert.ok(t("fa", "queue_waiting", 3).includes("نفر <code>3</code>"));
    assert.ok(t("en", "queue_waiting", 3).includes("position <code>3</code>"));
    assert.equal(t("en", "queue_waiting", 3).includes("نوبت"), false);
  });

  it("wraps external strings with Unicode isolate characters (U+2068 and U+2069)", () => {
    const text = "Track Title (feat. Artist)";
    const isolated = isolate(text);

    assert.equal(isolated, `⁨${text}⁩`);
    assert.ok(isolated.startsWith("⁨"));
    assert.ok(isolated.endsWith("⁩"));
  });

  it("manages new user vs existing user language flow correctly", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const users = new UsersRepository(db);

    // 1. Existing user (simulated with lang_set=1)
    db.prepare("INSERT INTO users (telegram_id, username, language, lang_set) VALUES ('1111', 'old_user', 'fa', 1)").run();
    assert.equal(users.isLanguageSet("1111"), true);
    assert.equal(users.getLanguage("1111"), "fa");

    // 2. New user (upsert creates with lang_set=0, language NULL)
    const newUser = users.upsert("2222", "new_user");
    assert.equal(users.isLanguageSet("2222"), false);

    // 3. User selects English
    users.setLanguage("2222", "en");
    assert.equal(users.isLanguageSet("2222"), true);
    assert.equal(users.getLanguage("2222"), "en");

    // 4. Memory cache handles subsequent checks without DB query
    assert.equal(users.getLanguage("2222"), "en");

    db.close();
  });

  it("preserves pending link during language selection", () => {
    storePendingLanguageLink(99999, "https://youtube.com/watch?v=pending123");
    const stored = pendingLanguageLinks.get(99999);

    assert.ok(stored);
    assert.equal(stored?.url, "https://youtube.com/watch?v=pending123");
    pendingLanguageLinks.delete(99999);
  });

  it("formats cache-hit caption in the requesting user's language", () => {
    // Simulated shared cache entry metadata
    const cachedItem = {
      title: "Bohemian Rhapsody",
      author: "Queen",
      durationSeconds: 355,
      fileSizeBytes: 10 * 1024 * 1024,
      platformName: "YouTube",
      botUsername: "mimo_downloader_bot"
    };

    // User 1 requests in Persian
    const captionFa = buildFinalCaption({ ...cachedItem, lang: "fa", isAudio: true });
    assert.ok(captionFa.includes("👤 خواننده: ⁨Queen⁩"));
    assert.ok(captionFa.includes("⏱ مدت: <code>05:55</code>"));

    // User 2 requests in English
    const captionEn = buildFinalCaption({ ...cachedItem, lang: "en", isAudio: true });
    assert.ok(captionEn.includes("👤 Artist: ⁨Queen⁩"));
    assert.ok(captionEn.includes("⏱ Duration: <code>05:55</code>"));
    assert.equal(captionEn.includes("خواننده"), false);
  });
});
