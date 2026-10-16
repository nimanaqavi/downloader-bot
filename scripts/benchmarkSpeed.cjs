const { Downloader } = require("../dist/src/services/downloader.js");
const { runProcess } = require("../dist/src/services/process.js");
const fs = require("node:fs");
const path = require("node:path");

async function measureYouTube(url, quality, label) {
  console.log(`\n>>> Benchmarking YouTube: ${label} (${quality})`);
  const dl = new Downloader(300_000, 500 * 1024 * 1024, undefined, 10800, 100 * 1024 * 1024, 1000);

  // 1. Measure metadata extraction
  const tMetaStart = Date.now();
  const meta = await dl.fetchMetadata(url);
  const metaMs = Date.now() - tMetaStart;

  // 2. Measure download and merge separately via yt-dlp verbose / progress
  // We can measure total download + merge time and inspect yt-dlp log for exact merge time
  const tDlStart = Date.now();
  const result = await dl.download(url, quality);
  const totalDlMs = Date.now() - tDlStart;

  const sizeMb = result.fileSizeBytes / (1024 * 1024);
  const speedMBs = sizeMb / (totalDlMs / 1000);

  console.log(`Results for ${label}:`);
  console.log(`  Title:         ${result.title}`);
  console.log(`  Size:          ${sizeMb.toFixed(2)} MB`);
  console.log(`  Metadata Time: ${metaMs} ms`);
  console.log(`  Total DL Time: ${totalDlMs} ms`);
  console.log(`  Overall Speed: ${speedMBs.toFixed(2)} MB/s`);

  if (result.tempDirectory) {
    fs.rmSync(result.tempDirectory, { recursive: true, force: true });
  }

  return { label, sizeMb, metaMs, totalDlMs, speedMBs };
}

async function measureConcurrentFragments(url) {
  console.log("\n>>> Comparing --concurrent-fragments (1 vs 4 vs 8)");
  const results = [];

  for (const frags of [1, 4, 8]) {
    const tempDir = fs.mkdtempSync(path.join("/tmp", `frag-test-${frags}-`));
    const args = [
      "--force-ipv4",
      "--no-warnings",
      "--no-mtime",
      "--no-cache-dir",
      "--concurrent-fragments", String(frags),
      "--format", "bv*[height<=?480]+ba/b[height<=?480]/b",
      "--output", path.join(tempDir, "test.%(ext)s"),
      url
    ];

    const t0 = Date.now();
    await runProcess("yt-dlp", args, 120_000);
    const elapsed = Date.now() - t0;

    const files = fs.readdirSync(tempDir);
    const size = files[0] ? fs.statSync(path.join(tempDir, files[0])).size / (1024 * 1024) : 0;
    const speed = size / (elapsed / 1000);

    console.log(`  Fragments = ${frags}: ${elapsed} ms for ${size.toFixed(2)} MB (${speed.toFixed(2)} MB/s)`);
    results.push({ frags, elapsed, size, speed });

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return results;
}

async function measureInstagramMeta(url) {
  console.log("\n>>> Comparing Instagram Metadata: Double-call vs Single-call");

  // Approach A: Current (getMediaItemCount with -J, then download probes with -J)
  const tA0 = Date.now();
  await runProcess("yt-dlp", ["--force-ipv4", "--no-warnings", "--flat-playlist", "-J", url], 20_000);
  await runProcess("yt-dlp", ["--force-ipv4", "--no-warnings", "-J", "--no-playlist", url], 20_000);
  const timeA = Date.now() - tA0;

  // Approach B: Single-call (-J dumps all items and metadata in one shot)
  const tB0 = Date.now();
  await runProcess("yt-dlp", ["--force-ipv4", "--no-warnings", "-J", url], 20_000);
  const timeB = Date.now() - tB0;

  console.log(`  Approach A (Two separate -J calls): ${timeA} ms`);
  console.log(`  Approach B (Single -J call):        ${timeB} ms`);
  console.log(`  Savings: ${timeA - timeB} ms (${(((timeA - timeB) / timeA) * 100).toFixed(1)}% faster)`);

  return { timeA, timeB };
}

async function main() {
  const ytUrl100Mb = "https://www.youtube.com/watch?v=l6zflbTGNFQ"; // ~56-84MB video tested earlier
  const igUrl = "https://www.instagram.com/reel/DeaLWAKRt7g/";

  console.log("Memory RSS before benchmarks:", (process.memoryUsage().rss / 1024 / 1024).toFixed(1), "MB");

  await measureConcurrentFragments(ytUrl100Mb);
  await measureInstagramMeta(igUrl);

  console.log("Memory RSS after benchmarks:", (process.memoryUsage().rss / 1024 / 1024).toFixed(1), "MB");
}

main().catch(console.error);
