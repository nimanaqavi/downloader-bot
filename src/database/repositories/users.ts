import type Database from "better-sqlite3";
import type { GlobalStats, User, UserListItem, UserStats } from "../../types/index.js";

interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_seen: string;
  is_banned: number;
  last_active: string;
}

const mapUser = (row: UserRow): User => ({
  id: row.id,
  telegramId: row.telegram_id,
  username: row.username,
  firstSeen: row.first_seen,
  isBanned: Boolean(row.is_banned),
  lastActive: row.last_active
});

export class UsersRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(telegramId: string, username?: string): User {
    this.db.prepare(`
      INSERT INTO users (telegram_id, username) VALUES (?, ?)
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

  list(page: number, pageSize: number): UserListItem[] {
    const rows = this.db.prepare(`
      SELECT u.*, COUNT(d.id) AS total_downloads
      FROM users u LEFT JOIN downloads d ON d.user_id = u.id
      GROUP BY u.id ORDER BY u.first_seen DESC LIMIT ? OFFSET ?
    `).all(pageSize, page * pageSize) as Array<UserRow & { total_downloads: number }>;
    return rows.map((row) => ({ ...mapUser(row), totalDownloads: row.total_downloads }));
  }

  setBanned(id: number, banned: boolean): void {
    this.db.prepare("UPDATE users SET is_banned = ? WHERE id = ?").run(banned ? 1 : 0, id);
  }

  allTelegramIds(): string[] {
    return (this.db.prepare("SELECT telegram_id FROM users ORDER BY id").all() as Array<{ telegram_id: string }>).map(
      (row) => row.telegram_id
    );
  }

  statsFor(id: number): UserStats {
    return this.db.prepare(`
      SELECT COUNT(d.id) AS totalDownloads,
        COALESCE(SUM(CASE WHEN d.created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END), 0) AS downloadsToday,
        COALESCE(SUM(CASE WHEN d.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS downloadsThisWeek,
        u.last_active AS lastActive
      FROM users u LEFT JOIN downloads d ON d.user_id = u.id WHERE u.id = ? GROUP BY u.id
    `).get(id) as UserStats;
  }

  globalStats(): GlobalStats {
    return this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM users) AS totalUsers,
        COUNT(*) AS totalDownloads,
        COALESCE(SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END), 0) AS downloadsToday,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successfulDownloads,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedDownloads
      FROM downloads
    `).get() as GlobalStats;
  }

  leaderboard(limit = 10): UserListItem[] {
    const rows = this.db.prepare(`
      SELECT u.*, COUNT(d.id) AS total_downloads FROM users u
      JOIN downloads d ON d.user_id = u.id GROUP BY u.id ORDER BY total_downloads DESC LIMIT ?
    `).all(limit) as Array<UserRow & { total_downloads: number }>;
    return rows.map((row) => ({ ...mapUser(row), totalDownloads: row.total_downloads }));
  }
}
