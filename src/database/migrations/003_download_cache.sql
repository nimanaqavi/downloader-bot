CREATE TABLE download_cache (
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

CREATE UNIQUE INDEX idx_cache_url_quality ON download_cache(url_normalized, quality);
CREATE INDEX idx_cache_created ON download_cache(created_at DESC);
