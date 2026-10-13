import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeMediaUrl } from "../src/utils/urlNormalizer.js";

describe("URL Normalizer", () => {
  it("strips tracking parameters from YouTube URLs", () => {
    const raw = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abcd1234efgh&feature=shared";
    const norm = normalizeMediaUrl(raw);
    assert.equal(norm, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("normalizes youtu.be short links to standard watch URLs", () => {
    const raw = "https://youtu.be/dQw4w9WgXcQ?si=xyz123";
    const norm = normalizeMediaUrl(raw);
    assert.equal(norm, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("normalizes YouTube shorts to standard watch URLs", () => {
    const raw = "https://www.youtube.com/shorts/abcd1234efg?si=foo";
    const norm = normalizeMediaUrl(raw);
    assert.equal(norm, "https://www.youtube.com/watch?v=abcd1234efg");
  });

  it("strips Instagram igsh tracking parameters", () => {
    const raw = "https://www.instagram.com/reel/C-12345/?igsh=MWZ4eHkz&utm_source=ig_web_copy_link";
    const norm = normalizeMediaUrl(raw);
    assert.equal(norm, "https://www.instagram.com/reel/C-12345/");
  });
});
