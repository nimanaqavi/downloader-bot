import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFinalCaption } from "../src/utils/formatting.js";

describe("Caption and Audio Metadata Builder", () => {
  it("formats Persian audio caption with 🎵, artist line, duration, and isolate chars", () => {
    const caption = buildFinalCaption({
      title: "Bohemian Rhapsody <Live>",
      author: "Queen & Freddie Mercury",
      durationSeconds: 355,
      fileSizeBytes: 10 * 1024 * 1024,
      platformName: "SoundCloud",
      botUsername: "mimo_bot",
      isAudio: true,
      lang: "fa"
    });

    assert.ok(caption.includes("🎵"));
    assert.ok(caption.includes("Bohemian Rhapsody &lt;Live&gt;"));
    assert.ok(caption.includes("👤 خواننده: ⁨Queen &amp; Freddie Mercury⁩"));
    assert.ok(caption.includes("⏱ مدت: <code>05:55</code>"));
    assert.ok(caption.includes("💾 حجم: <code>10 مگابایت</code>"));
    assert.ok(caption.includes("☁️ SoundCloud"));
    assert.ok(caption.includes("🤖 @mimo_bot"));
  });

  it("formats English audio caption with '👤 Artist: ' line", () => {
    const caption = buildFinalCaption({
      title: "Shape of You",
      author: "Ed Sheeran",
      durationSeconds: 233,
      fileSizeBytes: 5 * 1024 * 1024,
      platformName: "Spotify",
      botUsername: "mimo_bot",
      isAudio: true,
      lang: "en"
    });

    assert.ok(caption.includes("🎵"));
    assert.ok(caption.includes("👤 Artist: ⁨Ed Sheeran⁩"));
    assert.ok(caption.includes("⏱ Duration: <code>03:53</code>"));
    assert.ok(caption.includes("💾 Size: <code>5 MB</code>"));
    assert.ok(caption.includes("🟢 Spotify"));
  });

  it("formats video caption with 🎬 and omits author when not provided", () => {
    const caption = buildFinalCaption({
      title: "Funny Cat Video",
      durationSeconds: 45,
      fileSizeBytes: 15 * 1024 * 1024,
      platformName: "TikTok",
      botUsername: "mimo_bot",
      isAudio: false
    });

    assert.ok(caption.includes("🎬"));
    assert.ok(caption.includes("Funny Cat Video"));
    assert.equal(caption.includes("👤"), false);
    assert.ok(caption.includes("⏱ مدت: <code>00:45</code>"));
    assert.ok(caption.includes("🎶 TikTok"));
  });

  it("completely omits duration line if duration is 0, undefined, or null", () => {
    const caption = buildFinalCaption({
      title: "Live Stream or Unknown Duration",
      fileSizeBytes: 5 * 1024 * 1024,
      platformName: "Instagram",
      botUsername: "mimo_bot",
      durationSeconds: 0
    });

    assert.equal(caption.includes("⏱"), false);
    assert.equal(caption.includes("--:--"), false);
    assert.ok(caption.includes("💾 حجم: <code>5 مگابایت</code>"));
    assert.ok(caption.includes("📸 Instagram"));
  });

  it("strictly enforces caption length ceiling under 1024 characters", () => {
    const hugeTitle = "A".repeat(1500);
    const caption = buildFinalCaption({
      title: hugeTitle,
      author: "Very Long Author Name",
      durationSeconds: 120,
      fileSizeBytes: 20 * 1024 * 1024,
      platformName: "YouTube",
      botUsername: "mimo_bot"
    });

    assert.ok(caption.length <= 1024);
  });
});
