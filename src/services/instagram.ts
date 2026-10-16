import { existsSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "./process.js";

export interface InstagramMediaItem {
  id: string;
  type: "photo" | "video";
  url: string;
  duration?: number;
}

export interface InstagramPostInfo {
  title?: string;
  channel?: string;
  items: InstagramMediaItem[];
  error?: string;
}

export async function extractInstagramMedia(
  url: string,
  cookiesPath?: string
): Promise<InstagramPostInfo | null> {
  const scriptPath = join(process.cwd(), "scripts", "instagramExtractor.py");
  if (!existsSync(scriptPath)) {
    return null;
  }

  const args = [scriptPath, url];
  if (cookiesPath && existsSync(cookiesPath)) {
    args.push(cookiesPath);
  }

  try {
    const { stdout } = await runProcess("python3", args, 25_000);
    const json = JSON.parse(stdout.trim());
    if (json.error) {
      console.warn("[instagram extractor] Python error:", json.error);
      return null;
    }
    return json as InstagramPostInfo;
  } catch (err) {
    console.warn("[instagram extractor] Failed to execute python extractor:", err);
    return null;
  }
}
