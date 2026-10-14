import type Database from "better-sqlite3";
import type { GlobalStats, User, UserListItem, UserStats } from "../../types/index.js";

interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_seen: string;
  is_banned: number;
  is_blocked?: number;
  language?: string | null;
  lang_set?: number;
  last_active: string;
}

const mapUser = (row: UserRow): User => ({
  id: row.id,
  telegramId: row.telegram_id,
  username: row.username,
  firstSeen: row.first_seen,
  isBanned: Boolean(row.is_banned),
  isBlocked: Boolean(row.is_blocked),
  language: row.language ?? null,
  langSet: Boolean(row.lang_set),
  lastActive: row.last_active
});

export class UsersRepository {
  private languageCache = new Map<string, { lang: "fa" | "en"; langSet: boolean }>();
  private readonly MAX_CACHE_SIZE = 5000;

  constructor(private readonly db: Database.Database) {}

  upsert(telegramId: string, username?: string): User {
    this.db.prepare(`
      INSERT INTO users (telegram_id, username, lang_set) VALUES (?, ?, 0)
      ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, last_active = CURRENT_TIMESTAMP
    `).run(telegramId, username ?? null);
    return this.findByTelegramId(telegramId)!;
  }

  findByTelegramId(telegramId: string): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId) as UserRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  findById(id: number): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  }

  countNewUsersToday(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE date(first_seen) = date('now')")
        .get() as { count: number }
    ).count;
  }

  countByLanguage(): { fa: number; en: number; unset: number } {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN lang_set = 1 AND language = 'fa' THEN 1 ELSE 0 END), 0) AS fa,
        COALESCE(SUM(CASE WHEN lang_set = 1 AND language = 'en' THEN 1 ELSE 0 END), 0) AS en,
        COALESCE(SUM(CASE WHEN lang_set = 0 OR language IS NULL THEN 1 ELSE 0 END), 0) AS unset
      FROM users
    `).get() as { fa: number; en: number; unset: number };

    return {
      fa: row?.fa || 0,
      en: row?.en || 0,
      unset: row?.unset || 0
    };
  }

  list(page: number, pageSize: number): UserListItem[] {
    const rows = this.db.prepare(`
      SELECT u.*, COUNT(d.id) AS total_downloads
      FROM users u LEFT JOIN downloads d ON d.user_id = u.id
      GROUP BY u.id ORDER BY u.first_seen DESC LIMIT ? OFFSET ?
    `).all(pageSize, page * pageSize) as Array<UserRow & { total_downloads: number }>;
    return rows.map((row) => ({ ...mapUser(row), totalDownloads: row.total_downloads }));
  }

  listBanned(limit = 10): User[] {
    const rows = this.db
      .prepare(`SELECT * FROM users WHERE is_banned = 1 ORDER BY last_active DESC LIMIT ?`)
      .all(limit) as UserRow[];
    return rows.map(mapUser);
  }

  setBanned(id: number, banned: boolean): void {
    this.db.prepare("UPDATE users SET is_banned = ? WHERE id = ?").run(banned ? 1 : 0, id);
  }

  banByTelegramId(telegramId: string, banned: boolean): boolean {
    const info = this.db
      .prepare("UPDATE users SET is_banned = ? WHERE telegram_id = ?")
      .run(banned ? 1 : 0, telegramId);
    return info.changes > 0;
  }

  setBlockedByTelegramId(telegramId: string, blocked: boolean): void {
    this.db
      .prepare("UPDATE users SET is_blocked = ? WHERE telegram_id = ?")
      .run(blocked ? 1 : 0, telegramId);
  }

  setLanguage(telegramId: string, language: "fa" | "en"): void {
    this.db.prepare("UPDATE users SET language = ?, lang_set = 1 WHERE telegram_id = ?").run(language, telegramId);
    this.updateLanguageCache(telegramId, language, true);
  }

  getLanguage(telegramId: string): "fa" | "en" {
    const cached = this.languageCache.get(telegramId);
    if (cached) return cached.lang;

    const row = this.db.prepare("SELECT language, lang_set FROM users WHERE telegram_id = ?").get(telegramId) as {
      language?: string | null;
      lang_set?: number;
    } | undefined;

    const lang: "fa" | "en" = row?.language === "en" ? "en" : "fa";
    this.updateLanguageCache(telegramId, lang, Boolean(row?.lang_set));
    return lang;
  }

  isLanguageSet(telegramId: string): boolean {
    const cached = this.languageCache.get(telegramId);
    if (cached) return cached.langSet;

    const row = this.db.prepare("SELECT lang_set FROM users WHERE telegram_id = ?").get(telegramId) as {
      lang_set?: number;
    } | undefined;

    const isSet = Boolean(row?.lang_set);
    return isSet;
  }

  private updateLanguageCache(telegramId: string, lang: "fa" | "en", langSet: boolean): void {
    if (this.languageCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.languageCache.keys().next().value;
      if (firstKey) this.languageCache.delete(firstKey);
    }
    this.languageCache.set(telegramId, { lang, langSet });
  }

  listBatchActive(offset: number, limit: number, langFilter?: "fa" | "en" | "all"): User[] {
    let sql = "SELECT * FROM users WHERE is_banned = 0 AND (is_blocked IS NULL OR is_blocked = 0)";
    const params: any[] = [];

    if (langFilter === "fa") {
      sql += " AND (language = 'fa' OR language IS NULL)";
    } else if (langFilter === "en") {
      sql += " AND language = 'en'";
    }

    sql += " ORDER BY id LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as UserRow[];
    return rows.map(mapUser);
  }

  allTelegramIds(): string[] {
    return (this.db.prepare("SELECT telegram_id FROM users WHERE is_banned = 0 AND (is_blocked IS NULL OR is_blocked = 0) ORDER BY id").all() as Array<{ telegram_id: string }>).map(
      (row) => row.telegram_id
    );
  }

  statsFor(userId: number): UserStats {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN date(created_at) >= date('now', '-7 days') THEN 1 ELSE 0 END) AS week,
        (SELECT last_active FROM users WHERE id = ?) AS last_active
      FROM downloads
      WHERE user_id = ?
    `).get(userId, userId) as { total: number; today: number | null; week: number | null; last_active: string };

    return {
      totalDownloads: row.total,
      downloadsToday: row.today ?? 0,
      downloadsThisWeek: row.week ?? 0,
      lastActive: row.last_active
    };
  }

  globalStats(): GlobalStats {
    const userRow = this.db.prepare("SELECT COUNT(*) AS total FROM users").get() as { total: number };
    const downloadRow = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM downloads
    `).get() as { total: number; today: number | null; success: number | null; failed: number | null };

    return {
      totalUsers: userRow.total,
      totalDownloads: downloadRow.total,
      downloadsToday: downloadRow.today ?? 0,
      successfulDownloads: downloadRow.success ?? 0,
      failedDownloads: downloadRow.failed ?? 0
    };
  }
}
