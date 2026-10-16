import { existsSync } from "node:fs";
import { mkdtemp, open, readdir, rename, stat } from "node:fs/promises";
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
  isPhoto?: boolean;
}

export function detectItemMediaType(meta: {
  ext?: string;
  vcodec?: string;
  acodec?: string;
  formats?: Array<{ vcodec?: string; acodec?: string; ext?: string }>;
  _type?: string;
}): MediaType {
  const ext = (meta.ext || "").toLowerCase();
  const vcodec = (meta.vcodec || "").toLowerCase();
  const acodec = (meta.acodec || "").toLowerCase();

  if (imageExtensions.has(ext)) return "photo";

  const hasVideoStream = Boolean(vcodec && vcodec !== "none");
  const hasAudioStream = Boolean(acodec && acodec !== "none");

  if (!hasVideoStream && !hasAudioStream) {
    if (meta.formats && meta.formats.length > 0) {
      const anyVideo = meta.formats.some((f) => f.vcodec && f.vcodec !== "none");
      if (anyVideo) return "video";
      const anyAudio = meta.formats.some((f) => f.acodec && f.acodec !== "none");
      if (anyAudio) return "audio";
      return "photo";
    }
    return "photo";
  }

  if (!hasVideoStream && hasAudioStream) {
    return "audio";
  }

  return "video";
}

export function buildYtDlpArgs(options: BuildArgsOptions): string[] {
  let sortRule = "res:720,ext:mp4:m4a";
  let formatRule = "b[height<=?720][ext=mp4]/b[height<=?720]/bv*[height<=?720]+ba/bv*[width<=?720]+ba/b/best";

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

  if (options.url.includes("tiktok.com")) {
    args.push("--impersonate", "chrome");
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
  } else if (options.isPhoto) {
    args.push(
      "--output",
      join(options.tempDirectory, "media.%(ext)s")
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

  if (!options.isPhoto) {
    args.push("--write-thumbnail", "--convert-thumbnails", "jpg");
  }

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
  thumbnailUrl?: string;
}

export class Downloader {
  private readonly timeoutMs: number;
  private readonly maxFileSizeBytes: number;
  private readonly cookiesPath?: string;
  private readonly maxDurationSeconds: number;
  private readonly diskSafetyMarginBytes: number;
  private readonly maxDiskBudgetMb?: number;
  private metadataCache = new Map<string, { meta: MediaMetadata; timestamp: number }>();
  private probeCache = new Map<string, { data: { mediaType: MediaType; width?: number; height?: number; title?: string; duration?: number; itemCount?: number }; timestamp: number }>();

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
    const cached = this.probeCache.get(`${url}:0`);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000 && cached.data.itemCount !== undefined) {
      return cached.data.itemCount;
    }

    const args = [
      "--force-ipv4",
      "--no-warnings",
      "--flat-playlist",
      "-J"
    ];
    if (url.includes("tiktok.com")) {
      args.push("--impersonate", "chrome");
    }
    if (this.cookiesPath && existsSync(this.cookiesPath)) {
      args.push("--cookies", this.cookiesPath);
    }
    args.push(url);

    try {
      const { stdout } = await runProcess("yt-dlp", args, 20_000);
      const json = JSON.parse(stdout);
      if (json._type === "playlist" && Array.isArray(json.entries)) {
        const count = Math.max(1, json.entries.length);
        this.probeCache.set(`${url}:0`, {
          data: {
            mediaType: detectItemMediaType(json.entries[0] || json),
            itemCount: count,
            title: json.title
          },
          timestamp: Date.now()
        });

        // Pre-cache individual entries if present
        json.entries.forEach((entry: any, i: number) => {
          this.probeCache.set(`${url}:${i + 1}`, {
            data: {
              mediaType: detectItemMediaType(entry),
              width: typeof entry.width === "number" ? entry.width : undefined,
              height: typeof entry.height === "number" ? entry.height : undefined,
              title: entry.title,
              duration: typeof entry.duration === "number" ? entry.duration : undefined
            },
            timestamp: Date.now()
          });
        });

        return count;
      }

      const mediaType = detectItemMediaType(json);
      this.probeCache.set(`${url}:0`, {
        data: {
          mediaType,
          itemCount: 1,
          width: typeof json.width === "number" ? json.width : undefined,
          height: typeof json.height === "number" ? json.height : undefined,
          title: json.title,
          duration: typeof json.duration === "number" ? json.duration : undefined
        },
        timestamp: Date.now()
      });

      return 1;
    } catch {
      return 1;
    }
  }

  async probeItem(
    url: string,
    playlistItem?: number
  ): Promise<{
    mediaType: MediaType;
    width?: number;
    height?: number;
    title?: string;
    duration?: number;
  }> {
    const key = `${url}:${playlistItem || 0}`;
    const cached = this.probeCache.get(key);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached.data;
    }

    const args = [
      "--force-ipv4",
      "--no-warnings",
      "-J"
    ];
    if (url.includes("tiktok.com")) {
      args.push("--impersonate", "chrome");
    }
    if (playlistItem) {
      args.push("--playlist-items", String(playlistItem));
    } else {
      args.push("--no-playlist");
    }
    if (this.cookiesPath && existsSync(this.cookiesPath)) {
      args.push("--cookies", this.cookiesPath);
    }
    args.push(url);

    try {
      const { stdout } = await runProcess("yt-dlp", args, 25_000);
      const json = JSON.parse(stdout);
      const entry =
        json._type === "playlist" && Array.isArray(json.entries) && json.entries[0]
          ? json.entries[0]
          : json;

      const mediaType = detectItemMediaType(entry);
      const data = {
        mediaType,
        width: typeof entry.width === "number" ? entry.width : undefined,
        height: typeof entry.height === "number" ? entry.height : undefined,
        title: entry.title,
        duration: typeof entry.duration === "number" ? entry.duration : undefined
      };
      this.probeCache.set(key, { data, timestamp: Date.now() });
      return data;
    } catch {
      return { mediaType: "video" };
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
      "%(title)s\t%(duration)s\t%(artist,creator,uploader,channel)s\t%(filesize,filesize_approx)s\t%(thumbnail)s\t%(id)s"
    ];
    if (url.includes("tiktok.com")) {
      args.push("--impersonate", "chrome");
    }
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
      let thumbnailUrl = parts[4]?.trim() || undefined;
      const videoId = parts[5]?.trim();

      // For YouTube, ensure standard medium thumbnail (480x360) is available
      if ((!thumbnailUrl || !thumbnailUrl.startsWith("https://")) && videoId) {
        thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      }

      const meta: MediaMetadata = {
        title,
        duration,
        author,
        uploader: author,
        filesizeApprox,
        thumbnailUrl
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
      isPhoto?: boolean;
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

    let isPhoto = options?.isPhoto ?? false;
    let probedWidth: number | undefined;
    let probedHeight: number | undefined;
    let probedTitle: string | undefined;
    let probedDuration: number | undefined;

    if (!isAudio && options?.isPhoto === undefined) {
      const probe = await this.probeItem(url, options?.playlistItem);
      if (probe.mediaType === "photo") {
        isPhoto = true;
      }
      probedWidth = probe.width;
      probedHeight = probe.height;
      probedTitle = probe.title;
      probedDuration = probe.duration;
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
      isYouTube,
      isPhoto
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

      // If no recognized extension was found, inspect files by magic bytes
      if (!videoFile && !audioFile && imageFiles.length === 0 && files.length > 0) {
        for (const fname of files) {
          const fpath = join(tempDirectory, fname);
          try {
            const fd = await open(fpath, "r");
            const buf = Buffer.alloc(12);
            await fd.read(buf, 0, 12, 0);
            await fd.close();

            if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
              const newName = "media.jpg";
              await rename(fpath, join(tempDirectory, newName));
              imageFiles.push(newName);
              break;
            } else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
              const newName = "media.png";
              await rename(fpath, join(tempDirectory, newName));
              imageFiles.push(newName);
              break;
            } else if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") {
              const newName = "media.webp";
              await rename(fpath, join(tempDirectory, newName));
              imageFiles.push(newName);
              break;
            }
          } catch {
            // Ignore inspection errors
          }
        }
      }

      let mediaFile: string | undefined;
      let mediaType: MediaType = "video";

      if (isPhoto && imageFiles.length > 0) {
        mediaFile = imageFiles[0];
        mediaType = "photo";
      } else if (videoFile) {
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
        title: cachedMeta?.title || probedTitle,
        author: cachedMeta?.author,
        durationSeconds: cachedMeta?.duration || probedDuration,
        width: probedWidth,
        height: probedHeight,
        downloadDurationMs
      };
    } catch (error) {
      await removeDirectory(tempDirectory);
      throw error;
    }
  }
}
