import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadResult } from "../types/index.js";

interface TikWmResponse {
  code: number;
  msg: string;
  data?: {
    id: string;
    title: string;
    duration: number;
    size: number;
    play: string; // Direct video link without watermark
    cover: string;
    author?: {
      unique_id: string;
      nickname: string;
    };
  };
}

export async function downloadTikTokViaTikWm(
  url: string
): Promise<(DownloadResult & { tempDirectory: string; author?: string; duration?: number }) | null> {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const json = (await res.json()) as TikWmResponse;
    if (json.code !== 0 || !json.data || !json.data.play) {
      return null;
    }

    const videoPlayUrl = json.data.play;
    const tempDirectory = await mkdtemp(join(tmpdir(), "tiktok-"));
    const videoPath = join(tempDirectory, "tiktok.mp4");

    // Download direct video stream
    const videoRes = await fetch(videoPlayUrl);
    if (!videoRes.ok || !videoRes.body) return null;

    const fileStream = createWriteStream(videoPath);
    // @ts-ignore
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    return {
      tempDirectory,
      mediaPath: videoPath,
      videoPath,
      mediaType: "video",
      fileSizeBytes: json.data.size || 0,
      title: json.data.title || "تیک‌تاک",
      durationSeconds: json.data.duration || undefined,
      platformName: "TikTok",
      author: json.data.author?.nickname || json.data.author?.unique_id
    };
  } catch (err) {
    console.warn("[tiktok tikwm] Error fetching via TikWM, will fallback:", err);
    return null;
  }
}
