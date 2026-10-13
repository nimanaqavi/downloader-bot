import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildYtDlpArgs } from "../src/services/downloader.js";

describe("Downloader Argument Builder", () => {
  it("builds correct arguments for YouTube 720p", () => {
    const args = buildYtDlpArgs({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      quality: "720p",
      tempDirectory: "/tmp/test",
      maxDurationSeconds: 10800,
      safeCapBytes: 500 * 1024 * 1024,
      isAudio: false,
      isYouTube: true
    });

    assert.ok(args.includes("--force-ipv4"));
    assert.ok(args.includes("--no-playlist"));
    assert.ok(args.includes("--match-filter"));
    assert.ok(args.some((a) => a.includes("duration <=? 10800")));
    assert.ok(args.includes("--format"));
    assert.ok(args.some((arg) => arg.includes("height<=?720")));
    assert.ok(args.includes("--format-sort"));
    assert.ok(args.includes("res:720,ext:mp4:m4a"));
    assert.ok(args.includes("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
  });

  it("builds correct arguments for YouTube 360p", () => {
    const args = buildYtDlpArgs({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      quality: "360p",
      tempDirectory: "/tmp/test",
      maxDurationSeconds: 10800,
      safeCapBytes: 250 * 1024 * 1024,
      isAudio: false,
      isYouTube: true
    });

    assert.ok(args.includes("res:360,ext:mp4:m4a"));
    assert.ok(args.some((arg) => arg.includes("height<=?360")));
  });

  it("builds correct arguments for Audio (MP3) extraction on any platform", () => {
    const args = buildYtDlpArgs({
      url: "https://soundcloud.com/artist/song",
      quality: "audio",
      tempDirectory: "/tmp/test",
      maxDurationSeconds: 10800,
      safeCapBytes: 500 * 1024 * 1024,
      isAudio: true,
      isYouTube: false
    });

    assert.ok(args.includes("-x"));
    assert.ok(args.includes("--audio-format"));
    assert.ok(args.includes("mp3"));
  });

  it("builds stream-copy remux arguments for non-YouTube / generic sites", () => {
    const args = buildYtDlpArgs({
      url: "https://www.tiktok.com/@user/video/123",
      quality: "compact",
      tempDirectory: "/tmp/test",
      maxDurationSeconds: 10800,
      safeCapBytes: 500 * 1024 * 1024,
      isAudio: false,
      isYouTube: false
    });

    assert.ok(args.includes("--remux-video"));
    assert.ok(args.includes("mp4"));
    // Progressive MP4 preference rule
    assert.ok(args.some((arg) => arg.includes("b[height<=?720][ext=mp4]")));
  });

  it("supports playlist item for carousel handling", () => {
    const args = buildYtDlpArgs({
      url: "https://instagram.com/p/12345",
      quality: "compact",
      tempDirectory: "/tmp/test",
      maxDurationSeconds: 10800,
      safeCapBytes: 500 * 1024 * 1024,
      playlistItem: 3,
      isAudio: false,
      isYouTube: false
    });

    assert.ok(args.includes("--playlist-items"));
    assert.ok(args.includes("3"));
    assert.ok(!args.includes("--no-playlist"));
  });
});
