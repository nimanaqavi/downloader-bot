CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
  last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_downloads_user_created ON downloads(user_id, created_at DESC);
CREATE INDEX idx_downloads_created ON downloads(created_at DESC);
