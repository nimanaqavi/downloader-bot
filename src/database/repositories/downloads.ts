import type Database from "better-sqlite3";
import type { DownloadRecord } from "../../types/index.js";

interface DownloadRow {
  id: number;
  user_id: number;
  url: string;
  platform: string | null;
  status: "success" | "failed";
  file_size_bytes: number | null;
  created_at: string;
}

const mapRow = (row: DownloadRow): DownloadRecord => ({
  id: row.id,
  userId: row.user_id,
  url: row.url,
  platform: row.platform ?? undefined,
  status: row.status,
  fileSizeBytes: row.file_size_bytes,
  createdAt: row.created_at
});

export class DownloadsRepository {
  constructor(private readonly db: Database.Database) {}

  create(
    userId: number,
    url: string,
    status: "success" | "failed",
    fileSize?: number,
    platform?: string
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO downloads (user_id, url, status, file_size_bytes, platform) VALUES (?, ?, ?, ?, ?)`
      )
      .run(userId, url, status, fileSize ?? null, platform ?? null);
    return Number(info.lastInsertRowid);
  }

  findById(id: number): DownloadRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM downloads WHERE id = ?`)
      .get(id) as DownloadRow | undefined;
    if (!row) return undefined;
    return mapRow(row);
  }

  countForUser(userId: number): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS count FROM downloads WHERE user_id = ?").get(userId) as {
        count: number;
      }
    ).count;
  }

  listForUser(userId: number, page: number, pageSize: number): DownloadRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(userId, pageSize, page * pageSize) as DownloadRow[];
    return rows.map(mapRow);
  }

  listForUserByPlatform(userId: number, platform?: string, limit: number = 5): DownloadRecord[] {
    if (platform && platform !== "all") {
      const rows = this.db
        .prepare(
          `SELECT * FROM downloads WHERE user_id = ? AND (platform = ? OR url LIKE ?) ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, platform, `%${platform}%`, limit) as DownloadRow[];
      return rows.map(mapRow);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(userId, limit) as DownloadRow[];
    return rows.map(mapRow);
  }
}
