import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildYtDlpArgs, detectItemMediaType } from "../src/services/downloader.js";

describe("Instagram & Universal Photo / Carousel Detection", () => {
  it("detects pure photo item from JSON metadata", () => {
    const photoMeta1 = {
      ext: "jpg",
      vcodec: "none",
      acodec: "none"
    };
    assert.equal(detectItemMediaType(photoMeta1), "photo");

    const photoMeta2 = {
      ext: "webp",
      width: 1080,
      height: 1080
    };
    assert.equal(detectItemMediaType(photoMeta2), "photo");

    const photoMetaWithFormats = {
      ext: "jpg",
      formats: [
        { vcodec: "none", acodec: "none", ext: "jpg" },
        { vcodec: "none", acodec: "none", ext: "webp" }
      ]
    };
    assert.equal(detectItemMediaType(photoMetaWithFormats), "photo");
  });

  it("detects video item from JSON metadata", () => {
    const videoMeta = {
      ext: "mp4",
      vcodec: "h264",
      acodec: "mp4a.40.5",
      width: 720,
      height: 1280
    };
    assert.equal(detectItemMediaType(videoMeta), "video");

    const videoFormatsMeta = {
      ext: "mp4",
      vcodec: "none",
      acodec: "none",
      formats: [
        { vcodec: "avc1.4d401f", acodec: "mp4a.40.2", ext: "mp4" }
      ]
    };
    assert.equal(detectItemMediaType(videoFormatsMeta), "video");
  });

  it("detects audio item when only audio stream exists", () => {
    const audioMeta = {
      ext: "m4a",
      vcodec: "none",
      acodec: "mp4a.40.2"
    };
    assert.equal(detectItemMediaType(audioMeta), "audio");
  });

  it("builds clean arguments for photo items (omits --remux-video and formatRule)", () => {
    const args = buildYtDlpArgs({
      url: "https://www.instagram.com/p/C-photo123/",
      quality: "compact",
      tempDirectory: "/tmp/photo-test",
      maxDurationSeconds: 10800,
      safeCapBytes: 500 * 1024 * 1024,
      isAudio: false,
      isYouTube: false,
      isPhoto: true
    });

    // Must NOT contain video remux or format filters
    assert.equal(args.includes("--remux-video"), false, "Must not remux photos to video");
    assert.equal(args.includes("--format"), false, "Must not apply video format rules to photos");
    assert.equal(args.includes("--write-thumbnail"), false, "Must not write extra thumbnails for photos");
    assert.ok(args.includes("--output"));
    assert.ok(args.some((a) => a.includes("media.%(ext)s")));
  });

  it("builds standard video arguments when isPhoto is false", () => {
    const args = buildYtDlpArgs({
      url: "https://www.instagram.com/reel/DeaLWAKRt7g/",
      quality: "compact",
      tempDirectory: "/tmp/video-test",
      maxDurationSeconds: 10800,
      safeCapBytes: 500 * 1024 * 1024,
      isAudio: false,
      isYouTube: false,
      isPhoto: false
    });

    assert.ok(args.includes("--remux-video"));
    assert.ok(args.includes("mp4"));
    assert.ok(args.includes("--format"));
    assert.ok(args.includes("--write-thumbnail"));
  });
});
