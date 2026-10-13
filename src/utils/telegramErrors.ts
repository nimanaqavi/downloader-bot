export function friendlyDownloadError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("سقف") || msg.includes("بیشتر از سقف")) {
      return msg;
    }
    const lower = msg.toLowerCase();
    if (lower.includes("max-filesize") || lower.includes("file is larger")) {
      return "حجم ویدیو بیشتر از سقف مجاز ربات (۵۰۰ مگابایت) است. لطفاً کیفیت پایین‌تر یا نسخه صوتی را انتخاب کنید.";
    }
    if (lower.includes("max-duration") || lower.includes("longer than max-duration")) {
      return "مدت زمان ویدیو بیشتر از حد مجاز (۲۰ دقیقه) است.";
    }
    if (lower.includes("format not available") || lower.includes("requested format")) {
      return "کیفیت انتخاب شده برای این ویدیو در دسترس نبود. لطفاً کیفیت دیگری (مثلاً 480p یا 720p) را انتخاب کنید.";
    }
    if (lower.includes("sign in to confirm") || lower.includes("bot")) {
      return "یوتیوب موقتاً دسترسی را محدود کرده است. لطفاً چند دقیقه بعد مجدداً تلاش کنید.";
    }
    if (lower.includes("timeout") || lower.includes("timed out")) {
      return "زمان پردازش یا دانلود بیش از حد طول کشید (Timeout). لطفاً کیفیت پایین‌تر را انتخاب کنید.";
    }
    if (lower.includes("private video") || lower.includes("this video is private") || lower.includes("login required") || lower.includes("members-only")) {
      return "این ویدیو خصوصی یا مخصوص اعضا است و امکان دانلود آن وجود ندارد.";
    }

    // Clean up long yt-dlp error output for display
    const cleanMsg = msg.replace(/^yt-dlp exited with code \d+:\s*/i, "").trim();
    const shortDetails = cleanMsg.split("\n").pop() || cleanMsg;
    return shortDetails;
  }
  return "خطا در پردازش و دانلود ویدیو. لطفاً لینک را بررسی کرده و مجدداً امتحان کنید.";
}
