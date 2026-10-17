import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadResult } from "../types/index.js";
import { validateSafeUrl } from "../utils/ssrf.js";

interface TikWmResponse {
  code: number;
  msg: string;
  data?: {
    id: string;
    title: string;
    duration: number;
    size: number;
    play: string;
    cover: string;
    author?: {
      unique_id: string;
      nickname: string;
    };
  };
}

class TikWmCircuitBreaker {
  private consecutiveFailures = 0;
  private disabledUntil = 0;
  private totalUsageCount = 0;
  private readonly FAILURE_THRESHOLD = 3;
  private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  isOpen(): boolean {
    if (this.disabledUntil > Date.now()) {
      return true; // Circuit is open (TikWM is temporarily disabled)
    }
    return false;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.disabledUntil = 0;
    this.totalUsageCount++;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this.disabledUntil = Date.now() + this.COOLDOWN_MS;
      console.warn(`[tiktok circuit breaker] TikWM failed ${this.consecutiveFailures} times consecutively. Disabled for 5 minutes.`);
    }
  }

  getUsageCount(): number {
    return this.totalUsageCount;
  }
}

export const tikWmCircuit = new TikWmCircuitBreaker();

export interface DownloadTikTokOptions {
  maxDurationSeconds?: number;
  maxFileSizeBytes?: number;
}

export async function downloadTikTokViaTikWm(
  url: string,
  options?: DownloadTikTokOptions
): Promise<(DownloadResult & { tempDirectory: string; author?: string; duration?: number }) | null> {
  if (tikWmCircuit.isOpen()) {
    console.info("[tiktok tikwm] Circuit breaker active. Skipping TikWM.");
    return null;
  }

  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s strict timeout

    let res: Response;
    try {
      res = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      tikWmCircuit.recordFailure();
      return null;
    }

    const json = (await res.json()) as TikWmResponse;
    if (json.code !== 0 || !json.data || !json.data.play) {
      tikWmCircuit.recordFailure();
      return null;
    }

    const videoPlayUrl = json.data.play;

    // Security: Only HTTPS allowed
    if (!videoPlayUrl.startsWith("https://")) {
      tikWmCircuit.recordFailure();
      return null;
    }

    // Security: Validate returned video URL through SSRF filter
    const ssrfCheck = await validateSafeUrl(videoPlayUrl);
    if (!ssrfCheck.valid) {
      console.warn("[tiktok tikwm] SSRF check rejected TikWM video URL:", videoPlayUrl);
      tikWmCircuit.recordFailure();
      return null;
    }

    // Check duration cap
    if (options?.maxDurationSeconds && json.data.duration > options.maxDurationSeconds) {
      throw new Error("مدت زمان ویدیو بیشتر از حد مجاز است.");
    }

    // Check size cap
    if (options?.maxFileSizeBytes && json.data.size > options.maxFileSizeBytes) {
      throw new Error("حجم فایل بیشتر از سقف مجاز سرور است.");
    }

    const tempDirectory = await mkdtemp(join(tmpdir(), "tiktok-"));
    const videoPath = join(tempDirectory, "tiktok.mp4");

    // Download stream with redirect control
    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 30_000);

    let videoRes: Response;
    try {
      videoRes = await fetch(videoPlayUrl, {
        signal: downloadController.signal,
        redirect: "follow"
      });
    } finally {
      clearTimeout(downloadTimeout);
    }

    if (!videoRes.ok || !videoRes.body) {
      tikWmCircuit.recordFailure();
      return null;
    }

    // Ensure final response URL after redirects also passes SSRF check
    if (videoRes.url && videoRes.url !== videoPlayUrl) {
      const finalSsrf = await validateSafeUrl(videoRes.url);
      if (!finalSsrf.valid) {
        console.warn("[tiktok tikwm] Redirected URL failed SSRF filter:", videoRes.url);
        tikWmCircuit.recordFailure();
        return null;
      }
    }

    const fileStream = createWriteStream(videoPath);
    // @ts-ignore
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    tikWmCircuit.recordSuccess();

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
    tikWmCircuit.recordFailure();
    console.warn("[tiktok tikwm] Error fetching via TikWM:", err);
    return null;
  }
}
