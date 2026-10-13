import type { Context } from "telegraf";

export interface BotContext extends Context {
  dbUser?: User;
}

export interface User {
  id: number;
  telegramId: string;
  username: string | null;
  firstSeen: string;
  isBanned: boolean;
  lastActive: string;
}

export interface UserListItem extends User {
  totalDownloads: number;
}

export interface DownloadRecord {
  id: number;
  userId: number;
  url: string;
  platform?: string;
  status: "success" | "failed";
  fileSizeBytes: number | null;
  createdAt: string;
}

export interface UserStats {
  totalDownloads: number;
  downloadsToday: number;
  downloadsThisWeek: number;
  lastActive: string;
}

export interface GlobalStats {
  totalUsers: number;
  totalDownloads: number;
  downloadsToday: number;
  successfulDownloads: number;
  failedDownloads: number;
}

export type MediaType = "video" | "audio" | "photo";

export interface DownloadResult {
  mediaPath: string;
  videoPath: string; // Backwards compatibility alias for mediaPath
  mediaType: MediaType;
  thumbnailPath?: string;
  fileSizeBytes: number;
  title?: string;
  durationSeconds?: number;
  platformName?: string;
  appliedQuality?: string;
}
