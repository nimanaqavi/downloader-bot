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
  instagramUrl: string;
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

export interface DownloadResult {
  videoPath: string;
  thumbnailPath?: string;
  fileSizeBytes: number;
  title?: string;
}
