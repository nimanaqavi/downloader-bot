import type Database from "better-sqlite3";
import { normalizePlatformKey, renderPlatformEmojiHtml } from "../../utils/platformEmoji.js";

export class SettingsRepository {
  private emojiCache = new Map<string, string>();

  constructor(private readonly db: Database.Database) {}

  get(key: string, defaultValue: string = ""): string {
    const row = this.db
      .prepare(`SELECT value FROM bot_settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO bot_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  isForceJoinEnabled(): boolean {
    return this.get("force_join_enabled", "false") === "true";
  }

  setForceJoinEnabled(enabled: boolean): void {
    this.set("force_join_enabled", enabled ? "true" : "false");
  }

  getForceJoinChannel(): string {
    return this.get("force_join_channel", "");
  }

  setForceJoinChannel(channel: string): void {
    this.set("force_join_channel", channel.trim());
  }

  // Custom Emoji Management
  getPlatformEmojiId(platform: string): string {
    const key = normalizePlatformKey(platform);
    if (this.emojiCache.has(key)) {
      return this.emojiCache.get(key) || "";
    }
    const val = this.get(`emoji_${key}`, "");
    this.emojiCache.set(key, val);
    return val;
  }

  setPlatformEmojiId(platform: string, emojiId: string): void {
    const key = normalizePlatformKey(platform);
    const cleanId = emojiId.trim();
    this.set(`emoji_${key}`, cleanId);
    this.emojiCache.set(key, cleanId);
  }

  getPlatformEmojiHtml(platform: string): string {
    const customId = this.getPlatformEmojiId(platform);
    return renderPlatformEmojiHtml(platform, customId);
  }
}
