import { runProcess } from "./process.js";

async function check(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await runProcess(command, args, 15_000);
    return (result.stdout || result.stderr).split(/\r?\n/)[0]?.trim() || "available";
  } catch {
    return null;
  }
}

export async function verifyRuntimeDependencies(autoUpdateYtDlp: boolean): Promise<void> {
  const [ytDlpVersion, ffmpegVersion] = await Promise.all([
    check("yt-dlp", ["--version"]),
    check("ffmpeg", ["-version"])
  ]);

  console.info(ytDlpVersion ? `[startup] yt-dlp: ${ytDlpVersion}` : "[startup] yt-dlp: MISSING");
  console.info(ffmpegVersion ? `[startup] ffmpeg: ${ffmpegVersion}` : "[startup] ffmpeg: MISSING");

  const missing = [!ytDlpVersion && "yt-dlp", !ffmpegVersion && "ffmpeg"].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Missing required dependencies: ${missing.join(", ")}. Run scripts/setup.sh (Linux/macOS) or scripts/setup.ps1 (Windows), then restart the bot.`
    );
  }

  if (autoUpdateYtDlp) {
    console.info("[startup] Updating yt-dlp...");
    try {
      const result = await runProcess("yt-dlp", ["-U"], 120_000);
      console.info(`[startup] ${result.stdout.trim() || "yt-dlp update completed"}`);
    } catch (error) {
      console.warn("[startup] yt-dlp auto-update failed; continuing with the installed version:", error);
    }
  }
}
