import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
    console.warn(`Could not remove temporary directory ${path}:`, error);
  });
}

export async function cleanupOrphanedTempDirs(): Promise<void> {
  try {
    const tempPath = tmpdir();
    const entries = await readdir(tempPath);
    for (const entry of entries) {
      if (entry.startsWith("mimo-") || entry.startsWith("media-bot-")) {
        const fullPath = join(tempPath, entry);
        await removeDirectory(fullPath);
      }
    }
  } catch (error) {
    console.warn("[cleanup] Failed to clean orphaned temp directories on startup:", error);
  }
}
