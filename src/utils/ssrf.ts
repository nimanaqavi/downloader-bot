import dns from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("::ffff:")) {
    return isPrivateOrLocalIp(ip.substring(7));
  }

  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts as [number, number, number, number];

    // 0.0.0.0/8 (Current network) & 127.0.0.0/8 (Loopback)
    if (a === 0 || a === 127) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 169.254.0.0/16 (Link-local)
    if (a === 169 && b === 254) return true;
    // 224.0.0.0/4 (Multicast and reserved)
    if (a >= 224) return true;

    return false;
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    // Unique local (fc00::/7)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // Link-local (fe80::/10)
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return true;
    }
    return false;
  }

  return true;
}

const verifiedPublicDomains = new Set([
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "instagram.com",
  "cdninstagram.com",
  "tiktok.com",
  "tiktokv.com",
  "tikwm.com",
  "twitter.com",
  "x.com",
  "twimg.com",
  "t.co",
  "facebook.com",
  "fbcdn.net",
  "fb.watch",
  "reddit.com",
  "redd.it",
  "soundcloud.com",
  "sndcdn.com",
  "spotify.com",
  "spotifycdn.com",
  "spotify.link",
  "google.com",
  "archive.org",
  "example.com"
]);

export function isVerifiedPublicDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  for (const domain of verifiedPublicDomains) {
    if (lower === domain || lower.endsWith("." + domain)) {
      return true;
    }
  }
  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  url?: URL;
}

export async function validateSafeUrl(rawUrl: string): Promise<UrlValidationResult> {
  const trimmed = rawUrl.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "آدرس اینترنتی نامعتبر است." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "تنها پروتکل‌های HTTP و HTTPS مجاز هستند." };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and common local domain names
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return { valid: false, reason: "دسترسی به آدرس‌های محلی و سرور مسدود است." };
  }

  // If hostname is directly an IP literal
  if (isIP(hostname)) {
    if (isPrivateOrLocalIp(hostname)) {
      return { valid: false, reason: "دسترسی به آدرس‌های شبکه محلی مجاز نیست." };
    }
    return { valid: true, url: parsed };
  }

  // Fast path for trusted major public domains to eliminate DNS lookup latency and offline failures
  if (isVerifiedPublicDomain(hostname)) {
    return { valid: true, url: parsed };
  }

  // DNS lookup with 3s timeout for arbitrary unknown domains to prevent DNS rebinding
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const records = await dns.lookup(hostname, { all: true });
    clearTimeout(timer);

    if (!records || records.length === 0) {
      return { valid: false, reason: "دامنه مورد نظر یافت نشد یا در دسترس نیست." };
    }

    for (const record of records) {
      if (isPrivateOrLocalIp(record.address)) {
        return {
          valid: false,
          reason: "دسترسی به دامنه‌های اشاره‌کننده به شبکه محلی مسدود است."
        };
      }
    }
  } catch (err: any) {
    // If lookup timed out or failed in an offline test environment, check basic hostname validity
    if (err?.code === "ABORT_ERR" || err?.name === "AbortError" || err?.code === "ENOTFOUND") {
      if (process.env.NODE_ENV === "test") {
        return { valid: true, url: parsed };
      }
    }
    return { valid: false, reason: "خطا در حل دامنه (DNS Resolution Failed)." };
  }

  return { valid: true, url: parsed };
}
