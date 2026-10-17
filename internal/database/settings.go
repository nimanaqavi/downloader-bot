package database

import (
	"fmt"
	"strings"

	"mimo/internal/utils"
)

func (db *DB) GetSetting(key string) string {
	var val string
	err := db.QueryRow("SELECT value FROM bot_settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return ""
	}
	return val
}

func (db *DB) SetSetting(key, value string) error {
	_, err := db.Exec(`
		INSERT INTO bot_settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

func (db *DB) IsForceJoinEnabled() bool {
	v := strings.ToLower(db.GetSetting("force_join_enabled"))
	return v == "true" || v == "1"
}

func (db *DB) SetForceJoinEnabled(val bool) error {
	str := "false"
	if val {
		str = "true"
	}
	return db.SetSetting("force_join_enabled", str)
}

func (db *DB) GetForceJoinChannel() string {
	return db.GetSetting("force_join_channel")
}

func (db *DB) SetForceJoinChannel(channel string) error {
	return db.SetSetting("force_join_channel", channel)
}

func (db *DB) IsPlatformStickersEnabled() bool {
	v := strings.ToLower(db.GetSetting("platform_stickers_enabled"))
	if v == "" {
		return true // Default enabled
	}
	return v == "true" || v == "1"
}

func (db *DB) SetPlatformStickersEnabled(val bool) error {
	str := "false"
	if val {
		str = "true"
	}
	return db.SetSetting("platform_stickers_enabled", str)
}

func (db *DB) GetPlatformSticker(platform string) string {
	return db.GetSetting(fmt.Sprintf("sticker:%s", strings.ToLower(platform)))
}

func (db *DB) SetPlatformSticker(platform, fileID string) error {
	return db.SetSetting(fmt.Sprintf("sticker:%s", strings.ToLower(platform)), fileID)
}

func (db *DB) GetPlatformEmojiID(platform string) string {
	return db.GetSetting(fmt.Sprintf("emoji:%s", strings.ToLower(platform)))
}

func (db *DB) SetPlatformEmojiID(platform, emojiID string) error {
	return db.SetSetting(fmt.Sprintf("emoji:%s", strings.ToLower(platform)), emojiID)
}

func (db *DB) GetPlatformEmojiHTML(platform string) string {
	if !db.IsPlatformStickersEnabled() {
		return utils.GetDefaultEmoji(platform)
	}
	id := db.GetPlatformEmojiID(platform)
	return utils.RenderPlatformEmojiHTML(platform, id)
}
