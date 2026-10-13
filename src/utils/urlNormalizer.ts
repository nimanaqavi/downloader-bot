const trackingParams = new Set([
  "si",
  "igsh",
  "fbclid",
  "gclid",
  "feature",
  "app",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "t",
  "s",
  "ref_src",
  "_r",
  "_t"
]);

export function normalizeMediaUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = "";

    // Delete tracking search params
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (trackingParams.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    // YouTube youtu.be normalization
    if (host === "youtu.be" && parsed.pathname.length > 1) {
      const videoId = parsed.pathname.slice(1).split("/")[0];
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // YouTube shorts normalization to standard watch
    if (host.includes("youtube.com") && parsed.pathname.startsWith("/shorts/")) {
      const videoId = parsed.pathname.split("/")[2];
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Instagram normalization
    if (host.includes("instagram.com")) {
      const cleanPath = parsed.pathname.replace(/\/+$/, "");
      return `https://www.instagram.com${cleanPath}/`;
    }

    // Strip trailing slashes on generic paths
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}
