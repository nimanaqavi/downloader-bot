ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('force_join_enabled', 'false');
INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('force_join_channel', '');
