package database

import (
	"database/sql"
	"fmt"
	"strconv"
	"time"
)

type User struct {
	ID             int64
	TelegramID     string
	Username       string
	FirstSeen      string
	IsBanned       bool
	LastActive     string
	Language       string
	IsBlocked      bool
	LangSet        bool
	TotalDownloads int
}

type UserStats struct {
	TotalUsers           int
	TotalDownloads       int
	SuccessfulDownloads  int
	FailedDownloads      int
	DownloadsToday       int
	LastActive           string
}

func (db *DB) GetOrCreateUser(telegramID int64, username string) (*User, error) {
	tgIDStr := strconv.FormatInt(telegramID, 10)
	now := time.Now().UTC().Format(time.RFC3339)

	var user User
	var isBannedInt, isBlockedInt, langSetInt int
	var nullUser sql.NullString

	err := db.QueryRow(`
		SELECT id, telegram_id, username, first_seen, is_banned, last_active, language, is_blocked, lang_set
		FROM users WHERE telegram_id = ?
	`, tgIDStr).Scan(
		&user.ID,
		&user.TelegramID,
		&nullUser,
		&user.FirstSeen,
		&isBannedInt,
		&user.LastActive,
		&user.Language,
		&isBlockedInt,
		&langSetInt,
	)

	if err == nil {
		user.IsBanned = isBannedInt == 1
		user.IsBlocked = isBlockedInt == 1
		user.LangSet = langSetInt == 1
		user.Username = nullUser.String

		// Update username & last_active
		_, _ = db.Exec(`
			UPDATE users SET username = ?, last_active = CURRENT_TIMESTAMP
			WHERE id = ?
		`, username, user.ID)

		return &user, nil
	}

	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("query user: %w", err)
	}

	// Insert new user
	res, err := db.Exec(`
		INSERT INTO users (telegram_id, username, first_seen, is_banned, last_active, language, is_blocked, lang_set)
		VALUES (?, ?, ?, 0, ?, 'fa', 0, 0)
	`, tgIDStr, username, now, now)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	id, _ := res.LastInsertId()
	return &User{
		ID:         id,
		TelegramID: tgIDStr,
		Username:   username,
		FirstSeen:  now,
		IsBanned:   false,
		LastActive: now,
		Language:   "fa",
		IsBlocked:  false,
		LangSet:    false,
	}, nil
}

func (db *DB) GetUserLanguage(telegramID int64) string {
	tgIDStr := strconv.FormatInt(telegramID, 10)
	var lang string
	err := db.QueryRow("SELECT language FROM users WHERE telegram_id = ?", tgIDStr).Scan(&lang)
	if err != nil || lang == "" {
		return "fa"
	}
	return lang
}

func (db *DB) IsUserLanguageSet(telegramID int64) bool {
	tgIDStr := strconv.FormatInt(telegramID, 10)
	var langSet int
	err := db.QueryRow("SELECT lang_set FROM users WHERE telegram_id = ?", tgIDStr).Scan(&langSet)
	if err != nil {
		return false
	}
	return langSet == 1
}

func (db *DB) SetUserLanguage(telegramID int64, lang string) error {
	tgIDStr := strconv.FormatInt(telegramID, 10)
	_, err := db.Exec(`
		UPDATE users SET language = ?, lang_set = 1, last_active = CURRENT_TIMESTAMP
		WHERE telegram_id = ?
	`, lang, tgIDStr)
	return err
}

func (db *DB) SetUserBanned(userID int64, banned bool) error {
	val := 0
	if banned {
		val = 1
	}
	_, err := db.Exec("UPDATE users SET is_banned = ? WHERE id = ?", val, userID)
	return err
}

func (db *DB) SetUserBannedByTelegramID(telegramID string, banned bool) error {
	val := 0
	if banned {
		val = 1
	}
	_, err := db.Exec("UPDATE users SET is_banned = ? WHERE telegram_id = ?", val, telegramID)
	return err
}

func (db *DB) SetUserBlocked(telegramID string, blocked bool) error {
	val := 0
	if blocked {
		val = 1
	}
	_, err := db.Exec("UPDATE users SET is_blocked = ? WHERE telegram_id = ?", val, telegramID)
	return err
}

func (db *DB) CountUsers() int {
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count
}

func (db *DB) CountNewUsersToday() int {
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM users WHERE DATE(first_seen) = DATE('now')").Scan(&count)
	return count
}

func (db *DB) CountByLanguage() (map[string]int, error) {
	rows, err := db.Query(`
		SELECT language, lang_set, COUNT(*) FROM users GROUP BY language, lang_set
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int{
		"fa":    0,
		"en":    0,
		"unset": 0,
	}

	for rows.Next() {
		var lang string
		var langSet, cnt int
		if err := rows.Scan(&lang, &langSet, &cnt); err == nil {
			if langSet == 0 {
				counts["unset"] += cnt
			} else if lang == "en" {
				counts["en"] += cnt
			} else {
				counts["fa"] += cnt
			}
		}
	}
	return counts, nil
}

func (db *DB) GlobalStats() (*UserStats, error) {
	var stats UserStats
	_ = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&stats.TotalUsers)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads").Scan(&stats.TotalDownloads)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE status = 'success'").Scan(&stats.SuccessfulDownloads)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE status = 'failed'").Scan(&stats.FailedDownloads)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE DATE(created_at) = DATE('now')").Scan(&stats.DownloadsToday)
	return &stats, nil
}

func (db *DB) StatsForUser(userID int64) (*UserStats, error) {
	var stats UserStats
	_ = db.QueryRow("SELECT last_active FROM users WHERE id = ?", userID).Scan(&stats.LastActive)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE user_id = ?", userID).Scan(&stats.TotalDownloads)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE user_id = ? AND status = 'success'", userID).Scan(&stats.SuccessfulDownloads)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE user_id = ? AND status = 'failed'", userID).Scan(&stats.FailedDownloads)
	_ = db.QueryRow("SELECT COUNT(*) FROM downloads WHERE user_id = ? AND DATE(created_at) = DATE('now')", userID).Scan(&stats.DownloadsToday)
	return &stats, nil
}

func (db *DB) FindUserByID(id int64) (*User, error) {
	var u User
	var isBannedInt, isBlockedInt, langSetInt int
	var nullUser sql.NullString

	err := db.QueryRow(`
		SELECT id, telegram_id, username, first_seen, is_banned, last_active, language, is_blocked, lang_set
		FROM users WHERE id = ?
	`, id).Scan(
		&u.ID,
		&u.TelegramID,
		&nullUser,
		&u.FirstSeen,
		&isBannedInt,
		&u.LastActive,
		&u.Language,
		&isBlockedInt,
		&langSetInt,
	)
	if err != nil {
		return nil, err
	}

	u.IsBanned = isBannedInt == 1
	u.IsBlocked = isBlockedInt == 1
	u.LangSet = langSetInt == 1
	u.Username = nullUser.String
	return &u, nil
}

func (db *DB) ListUsers(page, pageSize int) ([]User, error) {
	offset := page * pageSize
	rows, err := db.Query(`
		SELECT u.id, u.telegram_id, u.username, u.first_seen, u.is_banned, u.last_active, u.language, u.is_blocked, u.lang_set,
		       (SELECT COUNT(*) FROM downloads d WHERE d.user_id = u.id) as total_downloads
		FROM users u
		ORDER BY u.id DESC
		LIMIT ? OFFSET ?
	`, pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []User
	for rows.Next() {
		var u User
		var isBannedInt, isBlockedInt, langSetInt int
		var nullUser sql.NullString
		if err := rows.Scan(
			&u.ID,
			&u.TelegramID,
			&nullUser,
			&u.FirstSeen,
			&isBannedInt,
			&u.LastActive,
			&u.Language,
			&isBlockedInt,
			&langSetInt,
			&u.TotalDownloads,
		); err == nil {
			u.IsBanned = isBannedInt == 1
			u.IsBlocked = isBlockedInt == 1
			u.LangSet = langSetInt == 1
			u.Username = nullUser.String
			result = append(result, u)
		}
	}
	return result, nil
}

func (db *DB) ListBannedUsers(limit int) ([]User, error) {
	rows, err := db.Query(`
		SELECT id, telegram_id, username, first_seen, is_banned, last_active, language, is_blocked, lang_set
		FROM users WHERE is_banned = 1
		ORDER BY id DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []User
	for rows.Next() {
		var u User
		var isBannedInt, isBlockedInt, langSetInt int
		var nullUser sql.NullString
		if err := rows.Scan(
			&u.ID,
			&u.TelegramID,
			&nullUser,
			&u.FirstSeen,
			&isBannedInt,
			&u.LastActive,
			&u.Language,
			&isBlockedInt,
			&langSetInt,
		); err == nil {
			u.IsBanned = isBannedInt == 1
			u.IsBlocked = isBlockedInt == 1
			u.LangSet = langSetInt == 1
			u.Username = nullUser.String
			result = append(result, u)
		}
	}
	return result, nil
}

func (db *DB) ListBatchActiveUsers(offset, limit int, langFilter string) ([]User, error) {
	query := `
		SELECT id, telegram_id, username, first_seen, is_banned, last_active, language, is_blocked, lang_set
		FROM users
		WHERE is_banned = 0 AND is_blocked = 0
	`
	var args []any
	if langFilter == "fa" {
		query += " AND language = 'fa'"
	} else if langFilter == "en" {
		query += " AND language = 'en'"
	}
	query += " ORDER BY id ASC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []User
	for rows.Next() {
		var u User
		var isBannedInt, isBlockedInt, langSetInt int
		var nullUser sql.NullString
		if err := rows.Scan(
			&u.ID,
			&u.TelegramID,
			&nullUser,
			&u.FirstSeen,
			&isBannedInt,
			&u.LastActive,
			&u.Language,
			&isBlockedInt,
			&langSetInt,
		); err == nil {
			u.IsBanned = isBannedInt == 1
			u.IsBlocked = isBlockedInt == 1
			u.LangSet = langSetInt == 1
			u.Username = nullUser.String
			result = append(result, u)
		}
	}
	return result, nil
}
