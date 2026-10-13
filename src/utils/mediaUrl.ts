const allowedInstagramHosts = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com"
]);

const supportedInstagramPaths = /^\/(p|reel|reels|tv|stories)\//i;

const allowedYouTubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be"
]);

export type SupportedPlatform = "instagram" | "youtube";

export interface ParsedMediaUrl {
  url: string;
  platform: SupportedPlatform;
}

export function parseMediaUrl(input: string): ParsedMediaUrl | null {
  const candidate = input.trim().match(/https?:\/\/[^\s]+/i)?.[0];
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    // Check Instagram
    if (host === "instagram.com" || allowedInstagramHosts.has(url.hostname.toLowerCase())) {
      if (supportedInstagramPaths.test(url.pathname)) {
        url.hash = "";
        return { url: url.toString(), platform: "instagram" };
      }
    }

    // Check YouTube (all formats: youtu.be, /watch, /shorts, /live, etc.)
    if (
      host === "youtube.com" ||
      host === "youtu.be" ||
      allowedYouTubeHosts.has(url.hostname.toLowerCase())
    ) {
      if (host === "youtu.be" && url.pathname.length > 1) {
        url.hash = "";
        return { url: url.toString(), platform: "youtube" };
      }
      if (
        url.pathname.startsWith("/watch") ||
        url.pathname.startsWith("/shorts/") ||
        url.pathname.startsWith("/live/") ||
        url.pathname.startsWith("/embed/") ||
        url.searchParams.has("v")
      ) {
        url.hash = "";
        return { url: url.toString(), platform: "youtube" };
      }
    }

    return null;
  } catch {
    return null;
  }
}
