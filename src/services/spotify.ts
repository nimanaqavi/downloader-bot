import type { DownloadResult } from "../types/index.js";
import { validateSafeUrl } from "../utils/ssrf.js";
import { normalizeMediaUrl } from "../utils/urlNormalizer.js";
import type { Downloader } from "./downloader.js";
import { runProcess } from "./process.js";

export type SpotifyLinkType = "track" | "album" | "playlist" | "podcast" | "unknown";

export interface SpotifyTrackInfo {
  title: string;
  artist?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

export interface SpotifyParseResult {
  url: string;
  type: SpotifyLinkType;
  trackId?: string;
}

export interface SearchCandidate {
  id: string;
  title: string;
  duration?: number;
  uploader?: string;
  url: string;
  provider: "youtube" | "soundcloud";
}

export class SpotifyError extends Error {
  constructor(
    public readonly code: "unsupported_type" | "track_not_found" | "temporary_error",
    message: string
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

/**
 * Normalizes Spotify URLs, resolves spotify.link redirects safely, and classifies link type.
 */
export async function parseSpotifyUrl(rawUrl: string): Promise<SpotifyParseResult> {
  let targetUrl = rawUrl.trim();

  // 1. Resolve spotify.link short link redirects safely
  if (targetUrl.includes("spotify.link")) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      let res: Response;
      try {
        res = await fetch(targetUrl, {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const location = res.headers.get("location");
      if (location) {
        const ssrf = await validateSafeUrl(location);
        if (ssrf.valid && ssrf.url) {
          targetUrl = ssrf.url.toString();
        }
      }
    } catch (err) {
      console.warn("[spotify] Failed to resolve spotify.link redirect:", err);
    }
  }

  // 2. Normalize path and strip tracking params
  const cleanUrl = normalizeMediaUrl(targetUrl);
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    return { url: cleanUrl, type: "unknown" };
  }

  const pathname = parsed.pathname.toLowerCase();

  // 3. Classify link type
  if (pathname.includes("/track/")) {
    const match = targetUrl.match(/\/track\/([a-zA-Z0-9]+)/i);
    return { url: cleanUrl, type: "track", trackId: match ? match[1] : undefined };
  }
  if (pathname.includes("/album/")) {
    return { url: cleanUrl, type: "album" };
  }
  if (pathname.includes("/playlist/")) {
    return { url: cleanUrl, type: "playlist" };
  }
  if (pathname.includes("/episode/") || pathname.includes("/show/")) {
    return { url: cleanUrl, type: "podcast" };
  }

  return { url: cleanUrl, type: "unknown" };
}

/**
 * Fetches Spotify title, artist, and duration with retry and page metadata fallback.
 */
export async function fetchSpotifyMetadata(normalizedUrl: string): Promise<SpotifyTrackInfo> {
  // Strategy A: oEmbed with 2 retries (total 3 attempts) and backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(normalizedUrl)}`;
      let res: Response;
      try {
        res = await fetch(oembedUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0" }
        });
      } finally {
        clearTimeout(timeout);
      }

      if (res.ok) {
        const json = (await res.json()) as any;
        if (json.title) {
          return {
            title: json.title.trim(),
            artist: json.author_name ? json.author_name.trim() : undefined,
            thumbnailUrl: json.thumbnail_url || undefined
          };
        }
      }
    } catch (err) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 300));
      }
    }
  }

  // Strategy B: Fallback HTML Scraper (og:title, og:description, music:duration)
  try {
    const ssrf = await validateSafeUrl(normalizedUrl);
    if (ssrf.valid) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      let pageRes: Response;
      try {
        pageRes = await fetch(normalizedUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
      } finally {
        clearTimeout(timeout);
      }

      if (pageRes.ok) {
        const html = await pageRes.text();
        const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
        const durationMatch = html.match(/<meta\s+(?:property|name)=["']music:duration["']\s+content=["'](\d+)["']/i);
        const thumbMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);

        if (ogTitleMatch && ogTitleMatch[1]) {
          const rawTitle = ogTitleMatch[1].trim();
          let artist: string | undefined;
          if (ogDescMatch && ogDescMatch[1]) {
            // Usually formatted as "Song · Artist · Year" or "Artist · Song"
            const parts = ogDescMatch[1].split(/·|•/);
            if (parts.length > 1 && parts[1]?.trim()) {
              artist = parts[1].trim();
            }
          }
          const duration = durationMatch && durationMatch[1] ? parseInt(durationMatch[1], 10) : undefined;

          return {
            title: rawTitle,
            artist,
            durationSeconds: duration,
            thumbnailUrl: thumbMatch ? thumbMatch[1] : undefined
          };
        }
      }
    }
  } catch (err) {
    console.warn("[spotify] Metadata fallback scraper failed:", err);
  }

  throw new SpotifyError("temporary_error", "Failed to retrieve Spotify track metadata");
}

/**
 * Filters candidates to select closest match by duration, avoiding live/remix/cover unless requested.
 */
export function selectBestCandidate(
  candidates: SearchCandidate[],
  trackTitle: string,
  artist?: string,
  targetDuration?: number
): SearchCandidate | null {
  if (candidates.length === 0) return null;

  const lowerTitle = trackTitle.toLowerCase();
  const allowsLiveOrRemix =
    lowerTitle.includes("remix") ||
    lowerTitle.includes("live") ||
    lowerTitle.includes("cover") ||
    lowerTitle.includes("acoustic");

  // Filter unwanted variants
  const cleaned = candidates.filter((c) => {
    if (allowsLiveOrRemix) return true;
    const cTitle = c.title.toLowerCase();
    const isUnwanted =
      cTitle.includes("live") ||
      cTitle.includes("remix") ||
      cTitle.includes("cover") ||
      cTitle.includes("karaoke") ||
      cTitle.includes("instrumental");
    return !isUnwanted;
  });

  const pool = cleaned.length > 0 ? cleaned : candidates;

  // If target duration is known, find closest match within tolerances
  if (targetDuration && targetDuration > 0) {
    const sorted = [...pool].sort((a, b) => {
      const diffA = a.duration ? Math.abs(a.duration - targetDuration) : 9999;
      const diffB = b.duration ? Math.abs(b.duration - targetDuration) : 9999;
      return diffA - diffB;
    });

    const best = sorted[0];
    if (best && best.duration && Math.abs(best.duration - targetDuration) <= 45) {
      return best;
    }
  }

  return pool[0] ?? null;
}

/**
 * Searches for track on YouTube, automatically falling back to SoundCloud if YouTube fails or is blocked.
 */
export async function searchTrackOnProviders(
  trackTitle: string,
  artist?: string,
  targetDuration?: number
): Promise<{ candidate: SearchCandidate; query: string }> {
  const query = artist ? `${artist} - ${trackTitle}` : trackTitle;

  // 1. Try YouTube Search (ytsearch3:)
  try {
    const ytArgs = [
      "--force-ipv4",
      "--no-warnings",
      "--print",
      "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(webpage_url)s",
      `ytsearch3:${query}`
    ];
    const { stdout } = await runProcess("yt-dlp", ytArgs, 20_000);
    const lines = stdout.trim().split("\n").filter(Boolean);

    const ytCandidates: SearchCandidate[] = lines.map((line) => {
      const parts = line.split("\t");
      return {
        id: parts[0]?.trim() || "",
        title: parts[1]?.trim() || "",
        duration: parts[2] && !isNaN(Number(parts[2])) ? Number(parts[2]) : undefined,
        uploader: parts[3]?.trim() || "",
        url: parts[4]?.trim() || `https://www.youtube.com/watch?v=${parts[0]}`,
        provider: "youtube" as const
      };
    }).filter((c) => c.title.length > 0);

    const chosenYt = selectBestCandidate(ytCandidates, trackTitle, artist, targetDuration);
    if (chosenYt) {
      console.info(`[spotify resolved] "${trackTitle}" by "${artist || 'Unknown'}" -> YouTube: "${chosenYt.title}" (${chosenYt.url})`);
      return { candidate: chosenYt, query };
    }
  } catch (ytErr) {
    console.warn(`[spotify] YouTube search failed for "${query}", falling back to SoundCloud:`, ytErr);
  }

  // 2. Automatic Fallback to SoundCloud Search (scsearch3:)
  try {
    const scArgs = [
      "--force-ipv4",
      "--no-warnings",
      "--print",
      "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(webpage_url)s",
      `scsearch3:${query}`
    ];
    const { stdout } = await runProcess("yt-dlp", scArgs, 20_000);
    const lines = stdout.trim().split("\n").filter(Boolean);

    const scCandidates: SearchCandidate[] = lines.map((line) => {
      const parts = line.split("\t");
      return {
        id: parts[0]?.trim() || "",
        title: parts[1]?.trim() || "",
        duration: parts[2] && !isNaN(Number(parts[2])) ? Number(parts[2]) : undefined,
        uploader: parts[3]?.trim() || "",
        url: parts[4]?.trim() || "",
        provider: "soundcloud" as const
      };
    }).filter((c) => c.title.length > 0 && c.url.length > 0);

    const chosenSc = selectBestCandidate(scCandidates, trackTitle, artist, targetDuration);
    if (chosenSc) {
      console.info(`[spotify resolved] "${trackTitle}" by "${artist || 'Unknown'}" -> SoundCloud Fallback: "${chosenSc.title}" (${chosenSc.url})`);
      return { candidate: chosenSc, query };
    }
  } catch (scErr) {
    console.warn(`[spotify] SoundCloud fallback search failed for "${query}":`, scErr);
  }

  throw new SpotifyError("track_not_found", `Track "${query}" could not be found on YouTube or SoundCloud.`);
}

/**
 * End-to-end resolver and downloader for Spotify track URLs.
 */
export async function resolveSpotifyTrack(
  url: string,
  downloader: Downloader
): Promise<(DownloadResult & { tempDirectory: string; artist?: string }) | null> {
  const parsed = await parseSpotifyUrl(url);

  if (parsed.type !== "track") {
    throw new SpotifyError("unsupported_type", `Only single Spotify tracks are supported. Provided: ${parsed.type}`);
  }

  const meta = await fetchSpotifyMetadata(parsed.url);
  const { candidate } = await searchTrackOnProviders(meta.title, meta.artist, meta.durationSeconds);

  // Download chosen audio source
  const downloadRes = await downloader.download(candidate.url, "audio");

  return {
    ...downloadRes,
    title: meta.title,
    artist: meta.artist,
    durationSeconds: meta.durationSeconds || downloadRes.durationSeconds,
    platformName: "Spotify"
  };
}
