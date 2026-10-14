export const standardPlatformFallbackEmojis: Record<string, string> = {
  youtube: "▶️",
  instagram: "📸",
  tiktok: "🎶", // 🎶 used so it does not clash with 🎵 for audio titles
  spotify: "🟢",
  soundcloud: "☁️",
  x: "✖️",
  twitter: "✖️",
  facebook: "🌐",
  reddit: "🌐",
  generic: "🌐"
};

export function normalizePlatformKey(platform: string): string {
  const norm = platform.toLowerCase().trim();
  if (norm === "twitter") return "x";
  return norm;
}

export function getPlatformFallbackEmoji(platform: string): string {
  const key = normalizePlatformKey(platform);
  return standardPlatformFallbackEmojis[key] || "🌐";
}

/**
 * Returns Telegram HTML for platform emoji:
 * If customEmojiId is present: `<tg-emoji emoji-id="${customEmojiId}">${fallback}</tg-emoji>`
 * Otherwise returns standard fallback emoji.
 */
export function renderPlatformEmojiHtml(platform: string, customEmojiId?: string): string {
  const fallback = getPlatformFallbackEmoji(platform);
  if (customEmojiId && customEmojiId.trim()) {
    return `<tg-emoji emoji-id="${customEmojiId.trim()}">${fallback}</tg-emoji>`;
  }
  return fallback;
}
