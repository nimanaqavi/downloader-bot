import { statfs } from "node:fs/promises";

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
  factor: number;
  reason?: string;
}

/**
 * Calculates maximum safe download bytes based on actual free disk space.
 * Factor:
 *   1 = Progressive single-file download (no merge needed, stream copy)
 *   2 = Video + Audio separate DASH streams that require local merging (e.g., YouTube)
 */
export async function calculateSafeDownloadCap(options: {
  isMergeNeeded: boolean;
  configuredMaxBytes: number;
  safetyMarginBytes: number;
  targetPath?: string;
}): Promise<SafeCapCalculation> {
  const { freeBytes, freeMb } = await getDiskSpace(options.targetPath ?? ".");
  const factor = options.isMergeNeeded ? 2 : 1;

  if (freeBytes <= options.safetyMarginBytes) {
    const marginMb = Math.round(options.safetyMarginBytes / (1024 * 1024));
    return {
      allowed: false,
      safeCapBytes: 0,
      freeMb,
      factor,
      reason: `فضای خالی دیسک سرور (${freeMb} مگابایت) کمتر از سقف ایمنی ${marginMb} مگابایت است. عملیات جهت جلوگیری از پر شدن سرور متوقف شد.`
    };
  }

  const usableBytes = freeBytes - options.safetyMarginBytes;
  const maxSafeBytesForThisTask = Math.floor(usableBytes / factor);
  const safeCapBytes = Math.min(options.configuredMaxBytes, maxSafeBytesForThisTask);

  // If even a small 10MB download cannot fit, block
  if (safeCapBytes < 10 * 1024 * 1024) {
    return {
      allowed: false,
      safeCapBytes,
      freeMb,
      factor,
      reason: `فضای کافی برای پردازش و ذخیره فایل در سرور وجود ندارد (فضای در دسترس: ${freeMb} مگابایت).`
    };
  }

  return {
    allowed: true,
    safeCapBytes,
    freeMb,
    factor
  };
}
