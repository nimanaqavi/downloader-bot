import { existsSync } from "node:fs";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { DownloadResult, MediaType } from "../types/index.js";
import { calculateSafeDownloadCap } from "../utils/disk.js";
import { removeDirectory } from "../utils/files.js";
import { runProcess } from "./process.js";

const imageExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
const videoExtensions = new Set(["mp4", "mkv", "webm", "mov"]);
const audioExtensions = new Set(["mp3", "m4a", "aac", "opus", "flac", "ogg"]);

export type VideoQuality = "720p" | "480p" | "360p" | "audio" | "compact" | "best";

export interface DownloaderOptions {
  timeoutMs: number;
  maxFileSizeBytes: number;
  cookiesPath?: string;
  maxDurationSeconds?: number;
  diskSafetyMarginBytes?: number;
}

export interface BuildArgsOptions {
  url: string;
  quality: VideoQuality;
  tempDirectory: string;
  maxDurationSeconds: number;
  safeCapBytes: number;
  cookiesPath?: string;
  playlistItem?: number;
  isAudio: boolean;
  isYouTube: boolean;
}

export function buildYtDlpArgs(options: BuildArgsOptions): string[] {
  let sortRule = "res:720,ext:mp4:m4a";
  let formatRule = "b[height<=?720][ext=mp4]/b[height<=?720]/bv*[height<=?720]+ba/b";

  if (options.isYouTube) {
    if (options.quality === "360p") {
      sortRule = "res:360,ext:mp4:m4a";
      formatRule = "bv*[height<=?360]+ba/b[height<=?360]/bv*[width<=?360]+ba/b[width<=?360]/b";
    } else if (options.quality === "480p") {
      sortRule = "res:480,ext:mp4:m4a";
      formatRule =
        "bv*[height<=?480]+ba/b[height<=?480]/bv*[width<=?480]+ba/b[width<=?480]/bv*[height<=?360]+ba/b[height<=?360]";
    } else if (options.quality === "720p" || options.quality === "compact") {
      sortRule = "res:720,ext:mp4:m4a";
      formatRule = "bv*[height<=?720]+ba/b[height<=?720]/bv*[width<=?720]+ba/b[width<=?720]/bv*+ba/b";
    } else if (options.quality === "best") {
      sortRule = "res,ext:mp4:m4a";
      formatRule = "bv*+ba/b";
    }
  }

  const args: string[] = [
    "--force-ipv4",
    "--no-warnings",
    "--no-mtime",
    "--no-cache-dir",
    "--socket-timeout",
    "30",
    "--concurrent-fragments",
    "4", // 4 concurrent fragments for fast HLS/DASH streaming
    "--match-filter",
    `duration <=? ${options.maxDurationSeconds} & !is_live`,
    "--max-filesize",
    `${Math.floor(options.safeCapBytes)}`,
    "--no-live-from-start",
    "--format-sort",
    sortRule
  ];

  if (options.isYouTube && !options.isAudio) {
    args.push("--http-chunk-size", "10M");
  }

  if (options.playlistItem) {
    args.push("--playlist-items", String(options.playlistItem));
  } else {
    args.push("--no-playlist");
  }

  if (options.isAudio) {
    args.push(
      "-x",
      "--audio-format",
      "mp3",
      "--output",
      join(options.tempDirectory, "audio.%(ext)s")
    );
  } else {
    args.push(
      "--remux-video",
      "mp4",
      "--format",
      formatRule,
      "--output",
      join(options.tempDirectory, "media.%(ext)s")
    );
  }

  args.push("--write-thumbnail", "--convert-thumbnails", "jpg");

  const homeDir = homedir();
  const binDir = join(homeDir, "bin");
  const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  if (existsSync(join(binDir, ffmpegName))) {
    args.push("--ffmpeg-location", binDir);
  }

  if (options.cookiesPath && existsSync(options.cookiesPath)) {
    args.push("--cookies", options.cookiesPath);
  }

  args.push(options.url);
  return args;
}

export interface MediaMetadata {
  title: string;
  duration?: number;
  author?: string;
  uploader?: string;
  filesizeApprox?: number;
}

export class Downloader {
  private readonly timeoutMs: number;
  private readonly maxFileSizeBytes: number;
  private readonly cookiesPath?: string;
  private readonly maxDurationSeconds: number;
  private readonly diskSafetyMarginBytes: number;
  private readonly maxDiskBudgetMb?: number;
  private metadataCache = new Map<string, { meta: MediaMetadata; timestamp: number }>();

  constructor(
    timeoutMs: number,
    maxFileSizeBytes: number,
    cookiesPath?: string,
    maxDurationSeconds: number = 10800,
    diskSafetyMarginBytes: number = 100 * 1024 * 1024,
    maxDiskBudgetMb?: number
  ) {
    this.timeoutMs = timeoutMs;
    this.maxFileSizeBytes = maxFileSizeBytes;
    this.cookiesPath = cookiesPath;
    this.maxDurationSeconds = maxDurationSeconds;
    this.diskSafetyMarginBytes = diskSafetyMarginBytes;
    this.maxDiskBudgetMb = maxDiskBudgetMb;
  }

  async getMediaItemCount(url: string): Promise<number> {
    const args = [
      "--force-ipv4",
      "--no-warnings",
      "--flat-playlist",
      "-J"
    ];
    if (this.cookiesPath && existsSync(this.cookiesPath)) {
      args.push("--cookies", this.cookiesPath);
    }
    args.push(url);

    try {
      const { stdout } = await runProcess("yt-dlp", args, 20_000);
      const json = JSON.parse(stdout);
      if (json._type === "playlist" && Array.isArray(json.entries)) {
        return Math.max(1, json.entries.length);
      }
      return 1;
    } catch {
      return 1;
    }
  }

  async fetchMetadata(url: string): Promise<MediaMetadata> {
    const cached = this.metadataCache.get(url);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached.meta;
    }

    const args = [
      "--force-ipv4",
      "--no-warnings",
      "--no-playlist",
      "--print",
      "%(title)s\t%(duration)s\t%(artist,creator,uploader,channel)s\t%(filesize,filesize_approx)s"
    ];
    if (this.cookiesPath && existsSync(this.cookiesPath)) {
      args.push("--cookies", this.cookiesPath);
    }
    args.push(url);

    try {
      const { stdout } = await runProcess("yt-dlp", args, 25_000);
      const firstLine = stdout.trim().split("\n")[0] || "";
      const parts = firstLine.split("\t");
      const title = parts[0]?.trim() || "مدیا";
      const duration = parts[1] && !isNaN(Number(parts[1])) ? Number(parts[1]) : undefined;
      const rawAuthor = parts[2]?.trim();
      const author = rawAuthor && rawAuthor !== "NA" ? rawAuthor : undefined;
      const rawSize = parts[3]?.trim();
      const filesizeApprox = rawSize && !isNaN(Number(rawSize)) ? Number(rawSize) : undefined;

      const meta: MediaMetadata = {
        title,
        duration,
        author,
        uploader: author,
        filesizeApprox
      };

      this.metadataCache.set(url, { meta, timestamp: Date.now() });
      return meta;
    } catch {
      return {
        title: "مدیا"
      };
    }
  }

  async download(
    url: string,
    quality: VideoQuality = "compact",
    options?: {
      isInstagramCarousel?: boolean;
      playlistItem?: number;
      onProgress?: (percentage: number) => void;
    }
  ): Promise<DownloadResult & { tempDirectory: string; isAudio?: boolean; author?: string; downloadDurationMs: number }> {
    const startDownloadTime = Date.now();
    const isAudio = quality === "audio";
    const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(url);
    const isMergeNeeded = isYouTube && !isAudio;

    // Check actual free disk space dynamically before executing download
    const capCheck = await calculateSafeDownloadCap({
      isMergeNeeded,
      configuredMaxBytes: this.maxFileSizeBytes,
      safetyMarginBytes: this.diskSafetyMarginBytes,
      maxDiskBudgetMb: this.maxDiskBudgetMb
    });

    if (!capCheck.allowed) {
      throw new Error(capCheck.reason || "فضای کافی روی دیسک سرور موجود نیست.");
    }

    const tempDirectory = await mkdtemp(join(tmpdir(), "media-bot-"));

    const args = buildYtDlpArgs({
      url,
      quality,
      tempDirectory,
      maxDurationSeconds: this.maxDurationSeconds,
      safeCapBytes: capCheck.safeCapBytes,
      cookiesPath: this.cookiesPath,
      playlistItem: options?.playlistItem,
      isAudio,
      isYouTube
    });

    try {
      const processResult = await runProcess("yt-dlp", args, this.timeoutMs, options?.onProgress);
      if (processResult.stdout.includes("does not pass filter")) {
        throw new Error(
          "مدت زمان محتوا بیشتر از حد مجاز (حداکثر ۳ ساعت) است یا این محتوا یک پخش زنده (لایو) می‌باشد."
        );
      }
      const files = await readdir(tempDirectory);

      // Identify downloaded files
      const videoFile = files.find((name) =>
        videoExtensions.has(name.split(".").pop()?.toLowerCase() ?? "")
      );
      const audioFile = files.find((name) =>
        audioExtensions.has(name.split(".").pop()?.toLowerCase() ?? "")
      );
      const imageFiles = files.filter((name) =>
        imageExtensions.has(name.split(".").pop()?.toLowerCase() ?? "")
      );

      let mediaFile: string | undefined;
      let mediaType: MediaType = "video";

      if (videoFile) {
        mediaFile = videoFile;
        mediaType = "video";
      } else if (audioFile) {
        mediaFile = audioFile;
        mediaType = "audio";
      } else if (imageFiles.length > 0) {
        // Pure image / photo post (e.g. Instagram photo, tweet image)
        mediaFile = imageFiles[0];
        mediaType = "photo";
      }

      if (!mediaFile) {
        throw new Error(
          "فایل مدیا پس از دانلود ایجاد نشد. لطفاً از عمومی و در دسترس بودن محتوا مطمئن شوید."
        );
      }

      const filePath = join(tempDirectory, mediaFile);
      const fileSizeBytes = (await stat(filePath)).size;

      if (fileSizeBytes > capCheck.safeCapBytes) {
        const sizeMb = Math.round(fileSizeBytes / 1048576);
        const maxMb = Math.round(capCheck.safeCapBytes / 1048576);
        throw new Error(
          `حجم فایل (${sizeMb} مگابایت) بیشتر از سقف مجاز (${maxMb} مگابایت) است.`
        );
      }

      // Thumbnail identification (only for video/audio)
      let thumbnailPath: string | undefined;
      if (mediaType !== "photo") {
        const thumbName = imageFiles.find((name) => name !== mediaFile);
        if (thumbName) {
          thumbnailPath = join(tempDirectory, thumbName);
        }
      }

      const cachedMeta = this.metadataCache.get(url)?.meta;
      const downloadDurationMs = Date.now() - startDownloadTime;

      return {
        tempDirectory,
        mediaPath: filePath,
        videoPath: filePath,
        mediaType,
        thumbnailPath,
        fileSizeBytes,
        isAudio: mediaType === "audio",
        title: cachedMeta?.title,
        author: cachedMeta?.author,
        durationSeconds: cachedMeta?.duration,
        downloadDurationMs
      };
    } catch (error) {
      await removeDirectory(tempDirectory);
      throw error;
    }
  }
}
