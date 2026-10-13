export function friendlyDownloadError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("سقف") || msg.includes("بیشتر از سقف") || msg.includes("فضای خالی")) {
      return msg;
    }
    const lower = msg.toLowerCase();
    if (lower.includes("max-filesize") || lower.includes("file is larger") || lower.includes("larger than max-filesize")) {
      return "حجم فایل بیشتر از سقف مجاز سرور است. لطفاً کیفیت پایین‌تر یا نسخه صوتی را انتخاب کنید.";
    }
    if (lower.includes("max-duration") || lower.includes("longer than max-duration")) {
      return "مدت زمان محتوا بیشتر از حد مجاز (حداکثر ۳ ساعت) است.";
    }
    if (lower.includes("format not available") || lower.includes("requested format")) {
      return "فرمت یا کیفیت درخواستی برای این لینک در دسترس نیست.";
    }
    if (lower.includes("login required") || lower.includes("checkpoint_required") || lower.includes("login to instagram")) {
      return "این محتوا نیازمند ورود به حساب اینستاگرام است یا اکانت مورد نظر خصوصی (Private) می‌باشد.";
    }
    if (lower.includes("sign in to confirm") || lower.includes("bot")) {
      return "سرویس‌دهنده موقتاً دسترسی را مسدود کرده است. لطفاً چند دقیقه بعد مجدداً تلاش کنید.";
    }
    if (lower.includes("timeout") || lower.includes("timed out")) {
      return "زمان پردازش یا دانلود بیش از حد طول کشید (Timeout). لطفاً مجدداً امتحان کنید.";
    }
    if (
      lower.includes("private video") ||
      lower.includes("this video is private") ||
      lower.includes("members-only") ||
      lower.includes("post is private")
    ) {
      return "این محتوا خصوصی، مخصوص اعضا یا ناموجود است و امکان دانلود آن وجود ندارد.";
    }
    if (lower.includes("unsupported url") || lower.includes("no video formats found")) {
      return "این وب‌سایت یا لینک توسط دانلودر پشتیبانی نمی‌شود یا محتوای ویدیویی/صوتی در آن یافت نشد.";
    }

    // Clean up long yt-dlp error output for display
    const cleanMsg = msg.replace(/^yt-dlp exited with code \d+:\s*/i, "").trim();
    const shortDetails = cleanMsg.split("\n").pop() || cleanMsg;
    return shortDetails;
  }
  return "خطا در پردازش و دانلود مدیا. لطفاً از عمومی و سالم بودن لینک مطمئن شده و مجدداً امتحان کنید.";
}
