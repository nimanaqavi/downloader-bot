import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendlyDownloadError, sanitizeLog } from "../src/utils/telegramErrors.js";

describe("Telegram Errors Security and Sanitization", () => {
  it("proves raw stack trace, yt-dlp, traceback, and paths are NEVER leaked to user", () => {
    const rawError = new Error(
      `yt-dlp exited with code 1: Traceback (most recent call last):
      File "/home/hermemssss/bin/yt-dlp/extractor.py", line 42, in extract
      ERROR: [tiktok] Unable to download webpage: HTTP Error 403: Forbidden
      https://github.com/yt-dlp/yt-dlp/issues/1234`
    );

    const userMessage = friendlyDownloadError(rawError, "ERR-TEST01");

    assert.ok(userMessage.includes("ERR-TEST01"));
    assert.equal(userMessage.includes("/home/hermemssss/"), false);
    assert.equal(userMessage.includes("Traceback"), false);
    assert.equal(userMessage.includes("ERROR:"), false);
    assert.equal(userMessage.includes("https://github.com"), false);
    assert.equal(userMessage.includes("stack trace"), false);
    assert.equal(userMessage.includes("line 42"), false);
  });

  it("redacts bot tokens from logs completely", () => {
    const token = "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ_12345678";
    const rawLog = `Fetch failed: https://api.telegram.org/bot${token}/sendMessage with code 400`;

    const sanitized = sanitizeLog(rawLog);

    assert.equal(sanitized.includes(token), false);
    assert.ok(sanitized.includes("[REDACTED_TOKEN]"));
  });

  it("includes tracking error code in user message", () => {
    const err = new Error("Something unexpected happened");
    const msg = friendlyDownloadError(err, "ERR-ABC123", "fa");
    assert.ok(msg.includes("کد پیگیری: ERR-ABC123"));

    const msgEn = friendlyDownloadError(err, "ERR-XYZ789", "en");
    assert.ok(msgEn.includes("Error ID: ERR-XYZ789"));
  });
});
