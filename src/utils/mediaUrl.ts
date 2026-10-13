import { validateSafeUrl } from "./ssrf.js";

export type SupportedPlatform =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "twitter"
  | "facebook"
  | "reddit"
  | "soundcloud"
  | "spotify"
  | "generic";

export interface ParsedMediaUrl {
  url: string;
  platform: SupportedPlatform;
  platformName: string;
  isAudioRequested?: boolean;
  isUnsupportedDrm?: boolean;
}

export const platformDisplayNames: Record<SupportedPlatform, string> = {
  youtube: "یوتیوب",
  instagram: "اینستاگرام",
  tiktok: "تیک‌تاک",
  twitter: "توییتر (X)",
  facebook: "فیسبوک",
  reddit: "ردیت",
  soundcloud: "ساندکلاد",
  spotify: "اسپاتیفای",
  generic: "وب"
};

export async function parseMediaUrl(input: string): Promise<ParsedMediaUrl | null> {
  const trimmed = input.trim();
  const isAudioRequested = /^(?:\/mp3|mp3)\s+/i.test(trimmed);
  const candidate = trimmed.match(/https?:\/\/[^\s]+/i)?.[0];
  if (!candidate) return null;

  const validation = await validateSafeUrl(candidate);
  if (!validation.valid || !validation.url) return null;

  const url = validation.url;
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  let platform: SupportedPlatform = "generic";
  let isUnsupportedDrm = false;

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    platform = "youtube";
  } else if (host === "instagram.com" || host === "m.instagram.com") {
    platform = "instagram";
  } else if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    platform = "tiktok";
  } else if (host === "twitter.com" || host === "x.com" || host === "t.co") {
    platform = "twitter";
  } else if (
    host === "facebook.com" ||
    host === "fb.watch" ||
    host === "fb.com" ||
    host === "m.facebook.com"
  ) {
    platform = "facebook";
  } else if (host === "reddit.com" || host === "v.redd.it" || host.endsWith(".reddit.com")) {
    platform = "reddit";
  } else if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
    platform = "soundcloud";
  } else if (
    host === "spotify.com" ||
    host === "open.spotify.com" ||
    host === "spotify.link" ||
    host.endsWith(".spotify.com")
  ) {
    platform = "spotify";
    isUnsupportedDrm = true;
  } else {
    platform = "generic";
  }

  return {
    url: url.toString(),
    platform,
    platformName: platformDisplayNames[platform],
    isAudioRequested,
    isUnsupportedDrm
  };
}
