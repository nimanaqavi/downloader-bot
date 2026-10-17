package database

import (
	"database/sql"
	"fmt"
)

type DownloadRecord struct {
	ID            int64
	UserID        int64
	URL           string
	Status        string
	FileSizeBytes *int64
	CreatedAt     string
	Platform      string
}

func (db *DB) CreateDownload(userID int64, url string, status string, fileSizeBytes *int64, platform string) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO downloads (user_id, url, status, file_size_bytes, platform, created_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, userID, url, status, fileSizeBytes, platform)
	if err != nil {
		return 0, fmt.Errorf("insert download: %w", err)
	}
	return res.LastInsertId()
}

func (db *DB) ListDownloadsForUserByPlatform(userID int64, platform string, limit int) ([]DownloadRecord, error) {
	var query string
	var args []any

	if platform == "all" || platform == "" {
		query = `
			SELECT id, user_id, url, status, file_size_bytes, created_at, IFNULL(platform, '')
			FROM downloads
			WHERE user_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`
		args = []any{userID, limit}
	} else {
		query = `
			SELECT id, user_id, url, status, file_size_bytes, created_at, IFNULL(platform, '')
			FROM downloads
			WHERE user_id = ? AND LOWER(IFNULL(platform, '')) = LOWER(?)
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`
		args = []any{userID, platform, limit}
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []DownloadRecord
	for rows.Next() {
		var r DownloadRecord
		var size sql.NullInt64
		if err := rows.Scan(&r.ID, &r.UserID, &r.URL, &r.Status, &size, &r.CreatedAt, &r.Platform); err == nil {
			if size.Valid {
				r.FileSizeBytes = &size.Int64
			}
			records = append(records, r)
		}
	}
	return records, nil
}

func (db *DB) ListDownloadsForUser(userID int64, page, pageSize int) ([]DownloadRecord, error) {
	offset := page * pageSize
	rows, err := db.Query(`
		SELECT id, user_id, url, status, file_size_bytes, created_at, IFNULL(platform, '')
		FROM downloads
		WHERE user_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, userID, pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []DownloadRecord
	for rows.Next() {
		var r DownloadRecord
		var size sql.NullInt64
		if err := rows.Scan(&r.ID, &r.UserID, &r.URL, &r.Status, &size, &r.CreatedAt, &r.Platform); err == nil {
			if size.Valid {
				r.FileSizeBytes = &size.Int64
			}
			records = append(records, r)
		}
	}
	return records, nil
}

func (db *DB) CountDownloadsForUser(userID int64) int {
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE user_id = ?", userID).Scan(&count)
	return count
}

func (db *DB) FindDownloadURLByID(id int64) (string, string, error) {
	var url string
	var platform sql.NullString
	err := db.QueryRow("SELECT url, platform FROM downloads WHERE id = ?", id).Scan(&url, &platform)
	if err != nil {
		return "", "", err
	}
	return url, platform.String, nil
}
