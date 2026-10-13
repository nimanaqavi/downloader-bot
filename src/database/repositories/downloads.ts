import type Database from "better-sqlite3";
import type { DownloadRecord } from "../../types/index.js";

interface DownloadRow {
  id: number;
  user_id: number;
  url: string;
  status: "success" | "failed";
  file_size_bytes: number | null;
  created_at: string;
}

export class DownloadsRepository {
  constructor(private readonly db: Database.Database) {}

  create(userId: number, url: string, status: "success" | "failed", fileSize?: number): number {
    const info = this.db.prepare(`
      INSERT INTO downloads (user_id, url, status, file_size_bytes) VALUES (?, ?, ?, ?)
    `).run(userId, url, status, fileSize ?? null);
    return Number(info.lastInsertRowid);
  }

  findById(id: number): DownloadRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM downloads WHERE id = ?`).get(id) as DownloadRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      url: row.url,
      status: row.status,
      fileSizeBytes: row.file_size_bytes,
      createdAt: row.created_at
    };
  }

  countForUser(userId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM downloads WHERE user_id = ?").get(userId) as { count: number }).count;
  }

  listForUser(userId: number, page: number, pageSize: number): DownloadRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(userId, pageSize, page * pageSize) as DownloadRow[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      url: row.url,
      status: row.status,
      fileSizeBytes: row.file_size_bytes,
      createdAt: row.created_at
    }));
  }
}
