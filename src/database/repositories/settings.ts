import type Database from "better-sqlite3";

export class SettingsRepository {
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
}
