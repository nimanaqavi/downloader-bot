import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPlatformFallbackEmoji,
  renderPlatformEmojiHtml,
  standardPlatformFallbackEmojis
} from "../src/utils/platformEmoji.js";

describe("Platform Emojis & Custom Emoji Mapping", () => {
  it("provides standard fallback emojis for all supported platforms", () => {
    assert.equal(getPlatformFallbackEmoji("youtube"), "▶️");
    assert.equal(getPlatformFallbackEmoji("instagram"), "📸");
    assert.equal(getPlatformFallbackEmoji("tiktok"), "🎶"); // 🎶 distinct from 🎵
    assert.equal(getPlatformFallbackEmoji("spotify"), "🟢");
    assert.equal(getPlatformFallbackEmoji("soundcloud"), "☁️");
    assert.equal(getPlatformFallbackEmoji("x"), "✖️");
    assert.equal(getPlatformFallbackEmoji("twitter"), "✖️");
    assert.equal(getPlatformFallbackEmoji("facebook"), "🌐");
    assert.equal(getPlatformFallbackEmoji("reddit"), "🌐");
    assert.equal(getPlatformFallbackEmoji("unknown_site"), "🌐");
  });

  it("renders standard fallback when custom_emoji_id is not set", () => {
    assert.equal(renderPlatformEmojiHtml("youtube"), "▶️");
    assert.equal(renderPlatformEmojiHtml("spotify", ""), "🟢");
    assert.equal(renderPlatformEmojiHtml("tiktok", undefined), "🎶");
    assert.equal(renderPlatformEmojiHtml("x", "   "), "✖️");
  });

  it("renders <tg-emoji> tag when custom_emoji_id is set", () => {
    const ytCustom = renderPlatformEmojiHtml("youtube", "5368324170671202286");
    assert.equal(ytCustom, '<tg-emoji emoji-id="5368324170671202286">▶️</tg-emoji>');

    const spotifyCustom = renderPlatformEmojiHtml("spotify", "5411234567890123456");
    assert.equal(spotifyCustom, '<tg-emoji emoji-id="5411234567890123456">🟢</tg-emoji>');

    const tiktokCustom = renderPlatformEmojiHtml("tiktok", "5422345678901234567");
    assert.equal(tiktokCustom, '<tg-emoji emoji-id="5422345678901234567">🎶</tg-emoji>');

    const xCustom = renderPlatformEmojiHtml("x", "5433456789012345678");
    assert.equal(xCustom, '<tg-emoji emoji-id="5433456789012345678">✖️</tg-emoji>');
  });
});
