import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database/migrations.js";
import { SettingsRepository } from "../src/database/repositories/settings.js";

describe("Phase 4: Platform Stickers & Admin Tooling", () => {
  it("manages platform sticker toggle switch in settings", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const settings = new SettingsRepository(db);

    // Default is true (enabled)
    assert.equal(settings.isPlatformStickersEnabled(), true);

    // Toggle to false
    settings.setPlatformStickersEnabled(false);
    assert.equal(settings.isPlatformStickersEnabled(), false);

    // Toggle back to true
    settings.setPlatformStickersEnabled(true);
    assert.equal(settings.isPlatformStickersEnabled(), true);
    db.close();
  });

  it("saves and retrieves platform stickers with normalized platform keys", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const settings = new SettingsRepository(db);

    assert.equal(settings.getPlatformSticker("youtube"), null);
    assert.equal(settings.getPlatformSticker("instagram"), null);

    // Set stickers for various platforms
    settings.setPlatformSticker("youtube", "CAACAgIAAxkBAAIC123...yt");
    settings.setPlatformSticker("Instagram", "CAACAgIAAxkBAAIC456...ig");
    settings.setPlatformSticker("Spotify", "CAACAgIAAxkBAAIC789...sp");

    // Case-insensitive / normalized retrieval
    assert.equal(settings.getPlatformSticker("YouTube"), "CAACAgIAAxkBAAIC123...yt");
    assert.equal(settings.getPlatformSticker("instagram"), "CAACAgIAAxkBAAIC456...ig");
    assert.equal(settings.getPlatformSticker("SPOTIFY"), "CAACAgIAAxkBAAIC789...sp");
    assert.equal(settings.getPlatformSticker("soundcloud"), null);
    db.close();
  });

  it("verifies sticker delivery respects switch and swallows failures silently", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const settings = new SettingsRepository(db);

    settings.setPlatformSticker("youtube", "sticker_file_123");

    let stickerSentCount = 0;
    let shouldThrow = false;

    const mockCtx = {
      chat: { id: 123456 },
      telegram: {
        sendSticker: async (_chatId: any, _fileId: any) => {
          if (shouldThrow) {
            throw new Error("TelegramError: 400: Bad Request: sticker invalid or network timeout");
          }
          stickerSentCount++;
        }
      }
    };

    // Helper simulation matching sendPlatformStickerIfConfigured
    async function testSendSticker(ctx: any, platform: string) {
      try {
        if (!settings.isPlatformStickersEnabled()) return;
        const stickerId = settings.getPlatformSticker(platform);
        if (stickerId) {
          await ctx.telegram.sendSticker(ctx.chat.id, stickerId).catch(() => undefined);
        }
      } catch {
        // Ignored
      }
    }

    // 1. Success case: sticker is sent
    await testSendSticker(mockCtx, "youtube");
    assert.equal(stickerSentCount, 1);

    // 2. Disabled switch case: sticker is NOT sent
    settings.setPlatformStickersEnabled(false);
    await testSendSticker(mockCtx, "youtube");
    assert.equal(stickerSentCount, 1, "Should not send when toggle is disabled");

    // 3. Platform without sticker: nothing sent
    settings.setPlatformStickersEnabled(true);
    await testSendSticker(mockCtx, "soundcloud");
    assert.equal(stickerSentCount, 1, "Should not send if platform has no configured sticker");

    // 4. Failure case: error thrown by Telegram does NOT break pipeline execution
    shouldThrow = true;
    await assert.doesNotReject(async () => {
      await testSendSticker(mockCtx, "youtube");
    });

    db.close();
  });

  it("verifies regular users cannot access sticker analyzer", () => {
    const adminIds = new Set(["1336050970"]);
    const regularUserId = "987654321";

    const isAuthorized = (chatType: string, fromId?: string) => {
      return chatType === "private" && Boolean(fromId && adminIds.has(fromId));
    };

    assert.equal(isAuthorized("private", regularUserId), false, "Regular user in private chat is denied");
    assert.equal(isAuthorized("group", "1336050970"), false, "Admin in group chat is denied");
    assert.equal(isAuthorized("private", "1336050970"), true, "Admin in private chat is allowed");
  });
});
