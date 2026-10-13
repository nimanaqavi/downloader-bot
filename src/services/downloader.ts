import { existsSync } from "node:fs";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import type { DownloadResult } from "../types/index.js";
import { removeDirectory } from "../utils/files.js";
import { runProcess } from "./process.js";

const imageExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
const mediaExtensions = new Set(["mp4", "mkv", "webm", "mov", "mp3", "m4a"]);

export type VideoQuality = "720p" | "480p" | "360p" | "audio" | "compact" | "best";

export async function safeUpdateYtDlp(): Promise<void> {
  try {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const { stdout } = await runProcess(pythonCmd, ["-m", "pip", "install", "--upgrade", "yt-dlp"], 120_000);
    console.info("[yt-dlp update] stdout:", stdout.trim());
  } catch (err) {
    console.warn("[yt-dlp update] Failed to update safely:", err);
  }
}

export class Downloader {
  constructor(
    private readonly timeoutMs: number,
    private readonly maxFileSizeBytes: number,
    private readonly cookiesPath?: string
  ) {}

  async download(url: string, quality: VideoQuality = "compact"): Promise<DownloadResult & { tempDirectory: string; isAudio?: boolean }> {
    const tempDirectory = await mkdtemp(join(tmpdir(), "media-bot-"));
    const isAudio = quality === "audio";

    let sortRule = "res:720,ext:mp4:m4a";
    let formatRule = "bv*[height<=?720]+ba/b[height<=?720]/bv*[width<=?720]+ba/b[width<=?720]/bv*+ba/b";

    if (quality === "360p") {
      sortRule = "res:360,ext:mp4:m4a";
      formatRule = "bv*[height<=?360]+ba/b[height<=?360]/bv*[width<=?360]+ba/b[width<=?360]/b";
    } else if (quality === "480p") {
      sortRule = "res:480,ext:mp4:m4a";
      formatRule = "bv*[height<=?480]+ba/b[height<=?480]/bv*[width<=?480]+ba/b[width<=?480]/bv*[height<=?360]+ba/b[height<=?360]";
    } else if (quality === "720p" || quality === "compact") {
      sortRule = "res:720,ext:mp4:m4a";
      formatRule = "bv*[height<=?720]+ba/b[height<=?720]/bv*[width<=?720]+ba/b[width<=?720]/bv*+ba/b";
    } else if (quality === "best") {
      sortRule = "res,ext:mp4:m4a";
      formatRule = "bv*+ba/b";
    }

    const args: string[] = [
      "--force-ipv4",
      "--no-playlist",
      "--no-warnings",
      "--no-mtime",
      "--no-cache-dir",
      "--socket-timeout",
      "30",
      "--format-sort",
      sortRule,
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg"
    ];

    if (isAudio) {
      args.push(
        "-x",
        "--audio-format",
        "mp3",
        "--output",
        join(tempDirectory, "audio.%(ext)s")
      );
    } else {
      args.push(
        "--merge-output-format",
        "mp4",
        "--format",
        formatRule,
        "--output",
        join(tempDirectory, "media.%(ext)s")
      );
    }

    const homeDir = homedir();
    const binDir = join(homeDir, "bin");
    const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    if (existsSync(join(binDir, ffmpegName))) {
      args.push("--ffmpeg-location", binDir);
    }

    if (this.cookiesPath) args.push("--cookies", this.cookiesPath);
    args.push(url);

    try {
      await runProcess("yt-dlp", args, this.timeoutMs);
      const files = await readdir(tempDirectory);

      const targetFile = files.find((name) =>
        mediaExtensions.has(name.split(".").pop()?.toLowerCase() ?? "")
      );
      if (!targetFile) throw new Error("فایل مدیا پس از دانلود ایجاد نشد. لطفاً از عمومی بودن ویدیو مطمئن شوید.");

      const filePath = join(tempDirectory, targetFile);
      const fileSizeBytes = (await stat(filePath)).size;

      if (fileSizeBytes > this.maxFileSizeBytes) {
        const sizeMb = Math.round(fileSizeBytes / 1048576);
        const maxMb = Math.round(this.maxFileSizeBytes / 1048576);
        throw new Error(
          `حجم ویدیو (${sizeMb} مگابایت) بیشتر از سقف ${maxMb} مگابایت مجاز ربات است. لطفاً کیفیت پایین‌تر یا نسخه صوتی را انتخاب کنید.`
        );
      }

      const thumbnailName = files.find((name) =>
        imageExtensions.has(name.split(".").pop()?.toLowerCase() ?? "")
      );

      return {
        tempDirectory,
        videoPath: filePath,
        thumbnailPath: thumbnailName ? join(tempDirectory, thumbnailName) : undefined,
        fileSizeBytes,
        isAudio
      };
    } catch (error) {
      await removeDirectory(tempDirectory);
      throw error;
    }
  }
}
