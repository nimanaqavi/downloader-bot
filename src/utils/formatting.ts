export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isolate(text: string): string {
  if (!text) return "";
  return `⁨${text}⁩`;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds <= 0) {
    return "--:--";
  }
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  if (mb >= 1000) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

export function renderProgressBar(percentage: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const filledCount = Math.floor(clamped / 10);
  const emptyCount = 10 - filledCount;
  const bar = "▰".repeat(filledCount) + "▱".repeat(emptyCount);
  return `[${bar}] ${clamped}%`;
}

export function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

export function buildFinalCaption(opts: {
  title: string;
  author?: string;
  durationSeconds?: number;
  fileSizeBytes: number;
  platformName: string;
  botUsername: string;
  isAudio?: boolean;
  lang?: "fa" | "en";
}): string {
  const lang = opts.lang === "en" ? "en" : "fa";
  const icon = opts.isAudio ? "🎵" : "🎬";

  const isolatedTitle = isolate(escapeHtml(truncateText(opts.title, 80)));
  const titleLine = `${icon} <b>${isolatedTitle}</b>`;

  let authorLine = "";
  if (opts.author) {
    const isolatedAuthor = isolate(escapeHtml(truncateText(opts.author, 60)));
    if (opts.isAudio) {
      authorLine = lang === "en" ? `👤 Artist: ${isolatedAuthor}\n` : `👤 خواننده: ${isolatedAuthor}\n`;
    } else {
      authorLine = `👤 <i>${isolatedAuthor}</i>\n`;
    }
  }

  const durationPart =
    opts.durationSeconds && opts.durationSeconds > 0
      ? `⏱ مدت: <code>${formatDuration(opts.durationSeconds)}</code> │ `
      : "";
  const sizePart = `💾 حجم: <code>${formatBytes(opts.fileSizeBytes)}</code>`;
  const statsBlock = `<blockquote>${durationPart}${sizePart} │ 🌐 ${opts.platformName}</blockquote>`;

  let caption = [titleLine, authorLine, statsBlock, `🤖 @${opts.botUsername}`].filter(Boolean).join("\n");

  if (caption.length > 1024) {
    const overflow = caption.length - 1024;
    const shorterTitle = truncateText(opts.title, Math.max(20, 80 - overflow));
    const newTitleLine = `${icon} <b>${isolate(escapeHtml(shorterTitle))}</b>`;
    caption = [newTitleLine, authorLine, statsBlock, `🤖 @${opts.botUsername}`].filter(Boolean).join("\n");
  }

  return caption;
}
