package database

import (
	"database/sql"
)

type CacheEntry struct {
	ID              int64
	URLNormalized   string
	Quality         string
	ChatID          string
	MessageID       int
	FileID          string
	FileSizeBytes   int64
	MediaType       string
	Title           string
	DurationSeconds int
	CreatedAt       string
}

func (db *DB) SaveCache(entry CacheEntry) error {
	_, err := db.Exec(`
		INSERT INTO download_cache (
			url_normalized, quality, chat_id, message_id, file_id, file_size_bytes, media_type, title, duration_seconds, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(url_normalized, quality) DO UPDATE SET
			chat_id = excluded.chat_id,
			message_id = excluded.message_id,
			file_id = excluded.file_id,
			file_size_bytes = excluded.file_size_bytes,
			media_type = excluded.media_type,
			title = excluded.title,
			duration_seconds = excluded.duration_seconds,
			created_at = CURRENT_TIMESTAMP
	`,
		entry.URLNormalized,
		entry.Quality,
		entry.ChatID,
		entry.MessageID,
		entry.FileID,
		entry.FileSizeBytes,
		entry.MediaType,
		entry.Title,
		entry.DurationSeconds,
	)
	return err
}

func (db *DB) FindCache(urlNormalized, quality string) (*CacheEntry, error) {
	var e CacheEntry
	var fileID, title sql.NullString
	var fileSize, duration sql.NullInt64

	err := db.QueryRow(`
		SELECT id, url_normalized, quality, chat_id, message_id, file_id, file_size_bytes, media_type, title, duration_seconds, created_at
		FROM download_cache
		WHERE url_normalized = ? AND quality = ?
		ORDER BY id DESC LIMIT 1
	`, urlNormalized, quality).Scan(
		&e.ID,
		&e.URLNormalized,
		&e.Quality,
		&e.ChatID,
		&e.MessageID,
		&fileID,
		&fileSize,
		&e.MediaType,
		&title,
		&duration,
		&e.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	e.FileID = fileID.String
	e.Title = title.String
	if fileSize.Valid {
		e.FileSizeBytes = fileSize.Int64
	}
	if duration.Valid {
		e.DurationSeconds = int(duration.Int64)
	}

	return &e, nil
}

func (db *DB) HasQualityCache(urlNormalized, quality string) bool {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM download_cache
		WHERE url_normalized = ? AND quality = ?
	`, urlNormalized, quality).Scan(&count)
	return err == nil && count > 0
}

func (db *DB) CacheStats() (count int, totalSavedBytes int64, err error) {
	var total sql.NullInt64
	err = db.QueryRow(`
		SELECT COUNT(*), SUM(file_size_bytes) FROM download_cache
	`).Scan(&count, &total)
	if err != nil {
		return 0, 0, err
	}
	if total.Valid {
		totalSavedBytes = total.Int64
	}
	return count, totalSavedBytes, nil
}

func (db *DB) ClearCache() error {
	_, err := db.Exec("DELETE FROM download_cache")
	return err
}

func (db *DB) DeleteCache(urlNormalized, quality string) error {
	_, err := db.Exec(`
		DELETE FROM download_cache WHERE url_normalized = ? AND quality = ?
	`, urlNormalized, quality)
	return err
}
