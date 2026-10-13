export function friendlyDownloadError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    const lower = msg.toLowerCase();

    if (msg.includes("سقف") || msg.includes("بیشتر از سقف") || msg.includes("فضای خالی")) {
      return msg;
    }
    if (lower.includes("max-filesize") || lower.includes("file is larger")) {
      return "حجم این فایل بیشتر از سقف مجاز سرور است. لطفاً کیفیت پایین‌تر یا نسخه صوتی را انتخاب کنید.";
    }
    if (lower.includes("duration") || lower.includes("longer than") || lower.includes("does not pass filter")) {
      return "مدت زمان این ویدیو بیشتر از حد مجاز است یا در حال پخش زنده (Live) می‌باشد.";
    }
    if (lower.includes("spotify") || lower.includes("drm")) {
      return "⚠️ آهنگ‌های مستقیم اسپاتیفای قفل هستند و نمیشه مستقیم دانلودشون کرد. لطفاً اسم آهنگ یا لینکش از یوتیوب/ساندکلاد رو بفرست تا فوری تحویل بدم!";
    }
    if (lower.includes("login required") || lower.includes("checkpoint") || lower.includes("instagram")) {
      return "این پست اینستاگرام خصوصی (Private) است یا نیاز به ورود به حساب دارد.";
    }
    if (lower.includes("sign in") || lower.includes("bot")) {
      return "ارتباط با سرور مبدأ موقتاً محدود شده است. لطفاً چند دقیقه دیگر امتحان کنید.";
    }
    if (lower.includes("timeout") || lower.includes("timed out")) {
      return "زمان دانلود طولانی شد و متوقف گردید. لطفاً مجدداً امتحان کنید.";
    }
    if (lower.includes("private") || lower.includes("members-only")) {
      return "این ویدیو خصوصی یا مخصوص اعضا است و امکان دانلود آن وجود ندارد.";
    }
    if (lower.includes("tiktok")) {
      return "ارتباط با سرور تیک‌تاک برقرار نشد. لطفاً چند لحظه بعد مجدداً امتحان کنید.";
    }
  }

  return "متأسفانه ارتباط با سرور مبدأ برقرار نشد. لطفاً لینک را بررسی کرده و چند لحظه دیگر دوباره بفرستید.";
}
