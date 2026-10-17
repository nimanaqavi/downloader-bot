import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedUsedMb: number | null = null;
let lastUsedCheckTime = 0;
const CACHE_TTL_MS = 600_000; // Cache du result for 10 minutes (600,000 ms)

export function adjustCachedUsedMb(bytesDelta: number): void {
  if (cachedUsedMb !== null) {
    const deltaMb = bytesDelta / (1024 * 1024);
    cachedUsedMb = Math.max(0, Math.round((cachedUsedMb + deltaMb) * 10) / 10);
  }
}

export async function getAccountUsedMb(): Promise<number> {
  const now = Date.now();
  if (cachedUsedMb !== null && now - lastUsedCheckTime < CACHE_TTL_MS) {
    return cachedUsedMb;
  }

  try {
    const home = homedir();
    const { stdout } = await execFileAsync("du", ["-sm", home], { timeout: 5000 });
    const match = stdout.trim().match(/^(\d+)/);
    if (match && match[1]) {
      cachedUsedMb = Number(match[1]);
      lastUsedCheckTime = now;
      return cachedUsedMb;
    }
  } catch {
    // If du is not available (e.g. Windows) or times out, fallback to 0
  }

  return cachedUsedMb ?? 0;
}

export function setMockAccountUsedMb(mb: number | null): void {
  cachedUsedMb = mb;
  lastUsedCheckTime = mb !== null ? Date.now() : 0;
}

export interface DiskSpaceInfo {
  freeBytes: number;
  totalBytes: number;
  freeMb: number;
  totalMb: number;
}

export async function getDiskSpace(targetPath: string = "."): Promise<DiskSpaceInfo> {
  const stats = await statfs(targetPath);
  const bsize = Number(stats.bsize);
  const freeBytes = Number(stats.bfree) * bsize;
  const totalBytes = Number(stats.blocks) * bsize;

  return {
    freeBytes,
    totalBytes,
    freeMb: Math.round(freeBytes / (1024 * 1024)),
    totalMb: Math.round(totalBytes / (1024 * 1024))
  };
}

export interface SafeCapCalculation {
  allowed: boolean;
  safeCapBytes: number;
  freeMb: number;
  usableMb: number;
  factor: number;
  reason?: string;
}

/**
 * Calculates maximum safe download bytes based on real free disk space:
 * free = MAX_DISK_BUDGET_MB - used space (du of home) - safety margin
 * Factor:
 *   1 = Progressive single-file download (no merge needed, stream copy)
 *   2 = Video + Audio separate DASH streams that require local merging (e.g., YouTube)
 */
export async function calculateSafeDownloadCap(options: {
  isMergeNeeded: boolean;
  configuredMaxBytes: number;
  safetyMarginBytes: number;
  maxDiskBudgetMb?: number;
  targetPath?: string;
}): Promise<SafeCapCalculation> {
  const { freeBytes: statfsFreeBytes, freeMb: statfsFreeMb } = await getDiskSpace(options.targetPath ?? ".");
  const factor = options.isMergeNeeded ? 2 : 1;

  let effectiveFreeBytes = statfsFreeBytes;
  let effectiveFreeMb = statfsFreeMb;

  // When statfs returns the host cluster storage (e.g. 1.7 TB on Alwaysdata NFS mount):
  // Strictly enforce: free = MAX_DISK_BUDGET_MB - used space (du of home)
  if (options.maxDiskBudgetMb && statfsFreeMb > options.maxDiskBudgetMb * 2) {
    const usedMb = await getAccountUsedMb();
    const quotaFreeMb = Math.max(0, options.maxDiskBudgetMb - usedMb);
    effectiveFreeBytes = quotaFreeMb * 1024 * 1024;
    effectiveFreeMb = quotaFreeMb;
  }

  const marginMb = Math.round(options.safetyMarginBytes / (1024 * 1024));
  if (effectiveFreeBytes <= options.safetyMarginBytes) {
    return {
      allowed: false,
      safeCapBytes: 0,
      freeMb: effectiveFreeMb,
      usableMb: 0,
      factor,
      reason: `فضای خالی سهمیه سرور (${effectiveFreeMb} مگابایت) کمتر از سقف ایمنی ${marginMb} مگابایت است. عملیات جهت جلوگیری از پر شدن سرور متوقف شد.`
    };
  }

  const usableBytes = effectiveFreeBytes - options.safetyMarginBytes;
  const usableMb = Math.round(usableBytes / (1024 * 1024));
  const maxSafeBytesForThisTask = Math.floor(usableBytes / factor);
  const safeCapBytes = Math.min(options.configuredMaxBytes, maxSafeBytesForThisTask);

  // If even a small 10MB download cannot fit, block
  if (safeCapBytes < 10 * 1024 * 1024) {
    return {
      allowed: false,
      safeCapBytes,
      freeMb: effectiveFreeMb,
      usableMb,
      factor,
      reason: `فضای کافی برای پردازش و ذخیره فایل در سرور وجود ندارد (فضای در دسترس: ${usableMb} مگابایت).`
    };
  }

  return {
    allowed: true,
    safeCapBytes,
    freeMb: effectiveFreeMb,
    usableMb,
    factor
  };
}
