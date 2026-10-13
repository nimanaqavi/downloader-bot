import type Database from "better-sqlite3";

export interface CacheRecord {
  id: number;
  urlNormalized: string;
  quality: string;
  chatId: string;
  messageId: number;
  fileId: string | null;
  fileSizeBytes: number | null;
  mediaType: string;
  title: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

interface CacheRow {
  id: number;
  url_normalized: string;
  quality: string;
  chat_id: string;
  message_id: number;
  file_id: string | null;
  file_size_bytes: number | null;
  media_type: string;
  title: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export class CacheRepository {
  constructor(private readonly db: Database.Database) {}

  find(urlNormalized: string, quality: string): CacheRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM download_cache WHERE url_normalized = ? AND quality = ? LIMIT 1`
      )
      .get(urlNormalized, quality) as CacheRow | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      urlNormalized: row.url_normalized,
      quality: row.quality,
      chatId: row.chat_id,
      messageId: row.message_id,
      fileId: row.file_id,
      fileSizeBytes: row.file_size_bytes,
      mediaType: row.media_type,
      title: row.title,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at
    };
  }

  hasQuality(urlNormalized: string, quality: string): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM download_cache WHERE url_normalized = ? AND quality = ? LIMIT 1`
      )
      .get(urlNormalized, quality);
    return Boolean(row);
  }

  save(data: {
    urlNormalized: string;
    quality: string;
    chatId: string;
    messageId: number;
    fileId?: string;
    fileSizeBytes?: number;
    mediaType?: string;
    title?: string;
    durationSeconds?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO download_cache (
          url_normalized, quality, chat_id, message_id, file_id, file_size_bytes, media_type, title, duration_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url_normalized, quality) DO UPDATE SET
          chat_id = excluded.chat_id,
          message_id = excluded.message_id,
          file_id = excluded.file_id,
          file_size_bytes = excluded.file_size_bytes,
          media_type = excluded.media_type,
          title = excluded.title,
          duration_seconds = excluded.duration_seconds,
          created_at = CURRENT_TIMESTAMP`
      )
      .run(
        data.urlNormalized,
        data.quality,
        data.chatId,
        data.messageId,
        data.fileId ?? null,
        data.fileSizeBytes ?? null,
        data.mediaType ?? "video",
        data.title ?? null,
        data.durationSeconds ?? null
      );
  }

  delete(urlNormalized: string, quality: string): void {
    this.db
      .prepare(`DELETE FROM download_cache WHERE url_normalized = ? AND quality = ?`)
      .run(urlNormalized, quality);
  }

  deleteById(id: number): void {
    this.db.prepare(`DELETE FROM download_cache WHERE id = ?`).run(id);
  }

  clear(): void {
    this.db.prepare(`DELETE FROM download_cache`).run();
  }

  stats(): { totalCount: number; totalSavedBytes: number } {
    const res = this.db
      .prepare(
        `SELECT COUNT(*) as count, COALESCE(SUM(file_size_bytes), 0) as totalBytes FROM download_cache`
      )
      .get() as { count: number; totalBytes: number };
    return {
      totalCount: res.count,
      totalSavedBytes: res.totalBytes
    };
  }
}
