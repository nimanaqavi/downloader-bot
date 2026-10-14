import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQualityCardText } from "../src/utils/formatting.js";

describe("YouTube Quality Card and Thumbnail Fallback", () => {
  it("builds YouTube quality card without title in caption (emoji + YouTube + duration only)", () => {
    const cardTextFa = buildQualityCardText({
      platform: "youtube",
      platformName: "یوتیوب",
      platformEmojiHtml: "▶️",
      title: "Big Buck Bunny 4K 60FPS",
      durationSeconds: 635,
      lang: "fa"
    });

    assert.ok(cardTextFa.includes("▶️ YouTube"));
    assert.ok(cardTextFa.includes("⏱ مدت: <code>10:35</code>"));
    // Title must NOT be present in YouTube quality card per specifications
    assert.equal(cardTextFa.includes("Big Buck Bunny"), false);

    const cardTextEn = buildQualityCardText({
      platform: "youtube",
      platformName: "YouTube",
      platformEmojiHtml: "▶️",
      title: "Big Buck Bunny 4K 60FPS",
      durationSeconds: 635,
      lang: "en"
    });

    assert.ok(cardTextEn.includes("▶️ YouTube"));
    assert.ok(cardTextEn.includes("⏱ Duration: <code>10:35</code>"));
    assert.equal(cardTextEn.includes("Big Buck Bunny"), false);
  });

  it("retains title in quality card for non-YouTube platforms", () => {
    const cardText = buildQualityCardText({
      platform: "soundcloud",
      platformName: "ساندکلاد",
      platformEmojiHtml: "☁️",
      title: "Cool Audio Track",
      durationSeconds: 180,
      lang: "fa"
    });

    assert.ok(cardText.includes("Cool Audio Track"));
    assert.ok(cardText.includes("☁️ ساندکلاد"));
    assert.ok(cardText.includes("⏱ مدت: <code>03:00</code>"));
  });

  it("handles fallback to text card cleanly if thumbnail photo is missing or fails", () => {
    const fallbackText = buildQualityCardText({
      platform: "youtube",
      platformName: "YouTube",
      platformEmojiHtml: '<tg-emoji emoji-id="5368324170671202286">▶️</tg-emoji>',
      title: "Video with broken thumbnail",
      durationSeconds: 45,
      lang: "en"
    });

    assert.ok(fallbackText.includes('<tg-emoji emoji-id="5368324170671202286">▶️</tg-emoji> YouTube'));
    assert.ok(fallbackText.includes("⏱ Duration: <code>00:45</code>"));
    assert.equal(fallbackText.includes("Video with broken thumbnail"), false);
  });
});
