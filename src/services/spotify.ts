import type { DownloadResult } from "../types/index.js";
import type { Downloader } from "./downloader.js";

interface SpotifyOEmbed {
  title?: string;
  thumbnail_url?: string;
  author_name?: string;
}

export async function resolveSpotifyTrack(
  url: string,
  downloader: Downloader
): Promise<(DownloadResult & { tempDirectory: string; artist?: string }) | null> {
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(oembedUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as SpotifyOEmbed;
    const trackTitle = data.title?.trim();
    if (!trackTitle) return null;

    const searchQuery = `ytsearch1:${trackTitle} audio`;
    const result = await downloader.download(searchQuery, "audio");

    return {
      ...result,
      title: trackTitle,
      artist: data.author_name || undefined,
      platformName: "Spotify"
    };
  } catch (err) {
    console.warn("[spotify resolve] Failed to resolve Spotify track:", err);
    return null;
  }
}
