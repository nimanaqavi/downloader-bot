package database

import (
	"fmt"
)

type migration struct {
	version int
	sql     string
}

var migrations = []migration{
	{
		version: 1,
		sql: `
			CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				telegram_id TEXT NOT NULL UNIQUE,
				username TEXT,
				first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
				last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS downloads (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				instagram_url TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
				file_size_bytes INTEGER,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_downloads_user_created ON downloads(user_id, created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC);
		`,
	},
	{
		version: 2,
		sql: `
			ALTER TABLE downloads RENAME COLUMN instagram_url TO url;
		`,
	},
	{
		version: 3,
		sql: `
			CREATE TABLE IF NOT EXISTS download_cache (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				url_normalized TEXT NOT NULL,
				quality TEXT NOT NULL,
				chat_id TEXT NOT NULL,
				message_id INTEGER NOT NULL,
				file_id TEXT,
				file_size_bytes INTEGER,
				media_type TEXT NOT NULL DEFAULT 'video',
				title TEXT,
				duration_seconds INTEGER,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_url_quality ON download_cache(url_normalized, quality);
			CREATE INDEX IF NOT EXISTS idx_cache_created ON download_cache(created_at DESC);
		`,
	},
	{
		version: 4,
		sql: `
			ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'fa';
			ALTER TABLE downloads ADD COLUMN platform TEXT;
		`,
	},
	{
		version: 5,
		sql: `
			ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
			CREATE TABLE IF NOT EXISTS bot_settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('force_join_enabled', 'false');
			INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('force_join_channel', '');
		`,
	},
	{
		version: 6,
		sql: `
			ALTER TABLE users ADD COLUMN lang_set INTEGER NOT NULL DEFAULT 0;
			UPDATE users SET lang_set = 1 WHERE language IS NOT NULL AND language != '';
		`,
	},
}

func (db *DB) runMigrations() error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	rows, err := db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int]bool)
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err == nil {
			applied[v] = true
		}
	}

	for _, m := range migrations {
		if !applied[m.version] {
			tx, err := db.Begin()
			if err != nil {
				return fmt.Errorf("begin migration %d: %w", m.version, err)
			}
			if _, err := tx.Exec(m.sql); err != nil {
				tx.Rollback()
				return fmt.Errorf("exec migration %d: %w", m.version, err)
			}
			if _, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES (?)", m.version); err != nil {
				tx.Rollback()
				return fmt.Errorf("record migration %d: %w", m.version, err)
			}
			if err := tx.Commit(); err != nil {
				return fmt.Errorf("commit migration %d: %w", m.version, err)
			}
		}
	}

	return nil
}
