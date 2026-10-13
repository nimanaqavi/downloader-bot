import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateSafeDownloadCap, setMockAccountUsedMb } from "../src/utils/disk.js";

describe("Dynamic Disk Safe Cap Calculation", () => {
  it("computes accurate cap with 1000MB budget, 171MB used, and 100MB margin", async () => {
    // Mock the du home result to 171 MB
    setMockAccountUsedMb(171);

    const configuredMaxBytes = 500 * 1024 * 1024; // 500 MB
    const safetyMarginBytes = 100 * 1024 * 1024; // 100 MB
    const maxDiskBudgetMb = 1000; // 1000 MB

    // Single-file download (factor 1)
    const singleCap = await calculateSafeDownloadCap({
      isMergeNeeded: false,
      configuredMaxBytes,
      safetyMarginBytes,
      maxDiskBudgetMb
    });

    assert.equal(singleCap.allowed, true);
    // free = 1000 - 171 = 829 MB
    // usable = 829 - 100 = 729 MB
    // factor 1: min(500 MB, 729 MB) = 500 MB
    assert.equal(Math.round(singleCap.safeCapBytes / (1024 * 1024)), 500);
    assert.equal(singleCap.usableMb, 729);
    assert.equal(singleCap.factor, 1);

    // Merged download (factor 2, YouTube DASH streams)
    const mergedCap = await calculateSafeDownloadCap({
      isMergeNeeded: true,
      configuredMaxBytes,
      safetyMarginBytes,
      maxDiskBudgetMb
    });

    assert.equal(mergedCap.allowed, true);
    // factor 2: min(500 MB, Math.floor(729 / 2)) = 364.5 MB -> 365 MB
    assert.equal(Math.round(mergedCap.safeCapBytes / (1024 * 1024)), 365);
    assert.equal(mergedCap.factor, 2);

    // Reset mock
    setMockAccountUsedMb(null);
  });

  it("blocks download if quota is exhausted", async () => {
    // Mock used to 950 MB (out of 1000 MB budget, with 100 MB margin)
    setMockAccountUsedMb(950);

    const cap = await calculateSafeDownloadCap({
      isMergeNeeded: false,
      configuredMaxBytes: 500 * 1024 * 1024,
      safetyMarginBytes: 100 * 1024 * 1024,
      maxDiskBudgetMb: 1000
    });

    assert.equal(cap.allowed, false);
    assert.ok(cap.reason?.includes("کمتر از سقف ایمنی"));

    setMockAccountUsedMb(null);
  });
});
